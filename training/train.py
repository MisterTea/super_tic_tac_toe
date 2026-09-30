"""Masked actor-critic self-play with a frozen opponent pool and JSON export."""
import argparse, copy, json, random, time
from pathlib import Path
import torch
from torch import nn
from game import Game

class Policy(nn.Module):
    def __init__(self):
        super().__init__()
        self.hidden=nn.Linear(171,128)
        self.actor=nn.Linear(128,81)
        self.critic=nn.Linear(128,1)
    def forward(self,x):
        h=torch.relu(self.hidden(x))
        return self.actor(h),self.critic(h).squeeze(-1)

def distribution(model,g):
    logits,value=model(torch.tensor(g.features()))
    mask=torch.full((81,),float('-inf'));mask[g.legal()]=0
    return torch.distributions.Categorical(logits=logits+mask),value

def evaluate(model,games,seed=991):
    rng=random.Random(seed); wins=draws=losses=0
    with torch.no_grad():
        for i in range(games):
            g=Game();side=1 if i%2==0 else -1
            while not g.winner:
                if g.turn==side:
                    d,_=distribution(model,g);a=int(d.logits.argmax())
                else: a=rng.choice(g.legal())
                g.step(a)
            wins+=g.winner==side;draws+=g.winner==2;losses+=g.winner==-side
    return dict(wins=wins,draws=draws,losses=losses,score=(wins+draws*.5)/games)

def export(model,path):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(dict(w1=model.hidden.weight.tolist(),b1=model.hidden.bias.tolist(),w2=model.actor.weight.tolist(),b2=model.actor.bias.tolist())))

def main():
    p=argparse.ArgumentParser();p.add_argument('--updates',type=int,default=1000);p.add_argument('--batch',type=int,default=32);p.add_argument('--eval-games',type=int,default=200);p.add_argument('--seed',type=int,default=7);p.add_argument('--resume');p.add_argument('--output',default='training/checkpoints');p.add_argument('--export',default='public/policy.json');args=p.parse_args()
    if args.updates<0 or args.batch<1 or args.eval_games<1:p.error('Invalid training budget')
    torch.set_num_threads(1);torch.manual_seed(args.seed);random.seed(args.seed)
    model=Policy();opt=torch.optim.Adam(model.parameters(),lr=3e-4)
    if args.resume:
        checkpoint=torch.load(args.resume,weights_only=True);model.load_state_dict(checkpoint['model']);opt.load_state_dict(checkpoint['optimizer'])
    baseline=evaluate(model,args.eval_games);pool=[copy.deepcopy(model).eval()];start=time.time()
    for update in range(args.updates):
        records=[]
        for episode in range(args.batch):
            g=Game();side=random.choice([-1,1]);opponent=random.choice(pool);trajectory=[]
            while not g.winner:
                if g.turn==side:
                    d,v=distribution(model,g);a=d.sample();trajectory.append((d.log_prob(a),v,d.entropy()));action=int(a)
                else:
                    with torch.no_grad():
                        if random.random()<.25:action=random.choice(g.legal())
                        else:action=int(distribution(opponent,g)[0].sample())
                g.step(action)
            reward=0 if g.winner==2 else 1 if g.winner==side else -1
            records.extend((lp,v,entropy,reward*.99**(len(trajectory)-j-1)) for j,(lp,v,entropy) in enumerate(trajectory))
        lp=torch.stack([r[0] for r in records]);values=torch.stack([r[1] for r in records]);entropy=torch.stack([r[2] for r in records]);returns=torch.tensor([r[3] for r in records]);adv=returns-values.detach()
        loss=-(lp*adv).mean()+.5*((values-returns)**2).mean()-.01*entropy.mean()
        opt.zero_grad();loss.backward();nn.utils.clip_grad_norm_(model.parameters(),1);opt.step()
        if (update+1)%25==0:
            pool.append(copy.deepcopy(model).eval());pool=pool[-8:]
            print(json.dumps(dict(update=update+1,loss=float(loss.detach()),elapsed=round(time.time()-start,1))),flush=True)
    report=dict(algorithm='masked actor-critic with frozen self-play opponents',seed=args.seed,updates=args.updates,batch=args.batch,baseline=baseline,evaluation=evaluate(model,args.eval_games),elapsed_seconds=time.time()-start,opponent='uniform random, greedy policy, alternating sides',limitation='Random-opponent evaluation does not establish strong human-level play.')
    out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    torch.save(dict(model=model.state_dict(),optimizer=opt.state_dict()),out/'policy.pt');(out/'metrics.json').write_text(json.dumps(report,indent=2));export(model,Path(args.export));print(json.dumps(report,indent=2))
if __name__=='__main__':main()
