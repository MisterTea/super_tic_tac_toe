"""Learn cognitive resource curves, then optionally fit human moves by simulation likelihood.
Synthetic priors are hypotheses, not a human skill calibration.
"""
import argparse, copy, json, math, random
from pathlib import Path
import torch
from torch import nn
from game import Game
from skill import move

KEYS=['radius','decay','macro','depth','breadth']
ANCHORS=[0,.25,.5,.75,1]
BOUNDS=[(.1,12),(.01,4),(.01,1),(1,4),(1,8)]
def prior(k):
    return [.3+8*k*k,2.4*(1-k)**2+.03,.05+.95*k*k,1+3*k*k,1+7*k*k]
def validate_records(path):
    rows=[]
    for line in Path(path).read_text().splitlines():
        if not line.strip():continue
        r=json.loads(line)
        if r.get('source')!='human':raise ValueError('Fitting rows must declare source=human')
        k=r['skill']
        if not isinstance(k,(int,float)) or not math.isfinite(k) or not 0<k<1:raise ValueError('Requires 0 < skill < 1')
        g=Game()
        for a in r['moves']:g.step(a)
        if isinstance(r['action'],bool) or not isinstance(r['action'],int) or r['action'] not in g.legal():raise ValueError('Illegal human action')
        focus=r.get('fixation')
        if focus is not None and (not isinstance(focus,list) or len(focus)!=2 or any(not isinstance(v,(float,int)) or not math.isfinite(v) or not 0<=v<=8 for v in focus)):raise ValueError('Fixation must be two finite 0..8 cell coordinates')
        rows.append((g,r['action'],k,focus))
    if not rows:raise ValueError('Empty dataset')
    return rows
def human_fit(model,rows,samples):
    def loss(m):
        total=0
        for index,row in enumerate(rows):
            g,a,k=row[:3];focus=row[3] if len(row)>3 else None
            count=sum(move(g,k,m,random.Random(index*10000+j),focus)==a for j in range(samples))
            total-=math.log((count+.5)/(samples+.5*len(g.legal())))
        return total/len(rows)
    baseline=loss(model);best=baseline
    for anchor in range(1,4):
        for j,key in enumerate(KEYS):
            for sign in [-1,1]:
                candidate=copy.deepcopy(model);step=[.6,.25,.12,1.,2.][j]
                lo,hi=BOUNDS[j]
                left,right=candidate['profiles'][anchor-1][key],candidate['profiles'][anchor+1][key]
                lo=max(lo,min(left,right));hi=min(hi,max(left,right))
                candidate['profiles'][anchor][key]=max(lo,min(hi,candidate['profiles'][anchor][key]+sign*step))
                score=loss(candidate)
                if score<best:model=candidate;best=score
    return model,dict(rows=len(rows),samples_per_choice=samples,before_nll=baseline,after_nll=best,method='coordinate search on smoothed Monte Carlo choice likelihood',warning='In-sample fit; validate on separate participants.')
def main():
    p=argparse.ArgumentParser();p.add_argument('--epochs',type=int,default=600);p.add_argument('--human-data');p.add_argument('--samples',type=int,default=8);p.add_argument('--expert',default='public/policy.json');p.add_argument('--output',default='public/skill-policy.json');args=p.parse_args()
    if args.epochs<1 or args.samples<1:p.error('Positive budgets required')
    torch.set_num_threads(1);torch.manual_seed(31)
    expert=json.loads(Path(args.expert).read_text())
    if expert.get('type')!='tactical-linear-v1':raise ValueError('Requires the benchmarked tactical expert')
    profiles=nn.Parameter(torch.tensor([prior(k) for k in ANCHORS])+torch.randn(5,5)*.08);opt=torch.optim.Adam([profiles],lr=.025)
    skills=torch.linspace(0,1,101);targets=torch.tensor([prior(float(k)) for k in skills]);scales=torch.tensor([8.,2.4,1.,3.,7.])
    for _ in range(args.epochs):
        index=(skills*4).long().clamp(max=3);t=(skills-index*.25)/.25
        predicted=profiles[index]*(1-t[:,None])+profiles[index+1]*t[:,None]
        fit=((predicted-targets)/scales).square().mean()
        monotonic=torch.relu(-(profiles[1:]-profiles[:-1])*torch.tensor([1.,-1.,1.,1.,1.])).square().mean()
        loss=fit+monotonic;opt.zero_grad();loss.backward();opt.step()
        with torch.no_grad():
            for j,(lo,hi) in enumerate(BOUNDS):profiles[:,j].clamp_(lo,hi)
    model=dict(type='cognitive-skill-v1',anchors=ANCHORS,profiles=[dict(zip(KEYS,row)) for row in profiles.detach().tolist()],expert=expert,provenance=dict(source='synthetic cognitive resource priors',humanCalibrated=False,targetSkill=.5))
    report=dict(seed=31,epochs=args.epochs,synthetic_loss=float(loss.detach()),human_fit=None,calibration='0.5 is a provisional novice target, not validated middle-school ability.')
    if args.human_data:
        model,report['human_fit']=human_fit(model,validate_records(args.human_data),args.samples)
        model['provenance']['source']='human choice likelihood fit after synthetic bootstrap'
    Path(args.output).write_text(json.dumps(model,indent=2));Path('training/skill-training-results.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=='__main__':main()
