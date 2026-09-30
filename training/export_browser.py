"""Export the trained tactical weights and cognitive profiles as an executable PyTorch graph."""
import json
from pathlib import Path
import torch
from torch import nn

class BrowserPolicy(nn.Module):
    def __init__(self,model):
        super().__init__()
        self.weights=nn.Parameter(torch.tensor(model['expert']['weights']),requires_grad=False)
        self.register_buffer('profiles',torch.tensor([[p[k] for k in ['radius','decay','macro','depth','breadth']] for p in model['profiles']]))
        self.register_buffer('board',torch.arange(81)//9)
        self.register_buffer('square',torch.arange(81)%9)
        self.register_buffer('knots',torch.arange(5,dtype=torch.float32)*.25)
        self.register_buffer('zero_profile',torch.tensor([.1,0.,0.,1.,81.]))
    def forward(self,features,skill,distances,ownership,noise,legal_mask,terminal):
        k=skill[0].clamp(0,1)
        mix=torch.relu(1-torch.abs(k-self.knots)*4)
        profile=mix@self.profiles
        notice=(noise[:9]<torch.exp(-profile[1]*torch.relu(distances-profile[0]))).float()
        macro=(noise[9]<profile[2]).float()*torch.prod(1-ownership+ownership*notice)
        local=notice[self.board];route=notice[self.square]
        gates=torch.stack([local,local,local*macro,local*macro,route,route*macro,route,torch.ones_like(local),local*macro,local,local*macro,local],dim=1)
        scores=(features*gates*self.weights).sum(dim=1)
        scores=torch.where(k<=0,torch.zeros_like(scores),scores)
        profile=torch.where(k<=0,self.zero_profile,profile)
        return scores+legal_mask,profile,terminal*macro*-1000

def example_inputs():
    return (torch.zeros(81,12),torch.tensor([.5]),torch.arange(9,dtype=torch.float32),torch.zeros(9),torch.full((10,),.5),torch.zeros(81),torch.zeros(1))

if __name__=='__main__':
    model=BrowserPolicy(json.loads(Path('public/skill-policy.json').read_text())).eval()
    Path('public/ai').mkdir(exist_ok=True)
    Path('training/checkpoints').mkdir(parents=True,exist_ok=True)
    torch.onnx.export(model,example_inputs(),'public/ai/policy.onnx',input_names=['features','skill','distances','ownership','noise','legal_mask','terminal'],output_names=['logits','profile','terminal_value'],opset_version=18,dynamo=True,external_data=False)
    torch.save(model.state_dict(),'training/checkpoints/browser-policy.pt')
    Path('public/ai/manifest.json').write_text(json.dumps(dict(format='onnx',source='PyTorch BrowserPolicy',skill_range=[0,1],profile_keys=['radius','decay','macro','depth','breadth'],endpoint='full-attention trained PyTorch scorer with maximum learned planning budget',humanCalibrated=False),indent=2))
    print('Exported public/ai/policy.onnx')
