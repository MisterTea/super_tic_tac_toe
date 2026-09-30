"""Warm-started shared tactical actor, optimized with self-play policy gradients."""
import argparse, copy, json, random, time
from pathlib import Path
import torch
from torch import nn
from game import Game
from evaluate import tactical

class TacticalPolicy(nn.Module):
    def __init__(self):
        super().__init__()
        # Tactical warm start avoids the sparse-reward trap of learning wins from scratch.
        self.weights=nn.Parameter(torch.tensor([5.,3.,100.,8.,-2.,-30.,0.,.2,0.,0.,0.,0.]))
    def distribution(self,g):
        actions=g.legal();x=torch.tensor([g.action_features(a) for a in actions])
        return actions,torch.distributions.Categorical(logits=x@self.weights)
    def move(self,g,greedy=False):
        a,d=self.distribution(g)
        return a[int(d.logits.argmax() if greedy else d.sample())]

def evaluate(model,games=100,seed=991,opponent='tactical'):
    rng=random.Random(seed);wins=draws=losses=0
    with torch.no_grad():
        for i in range(games):
            g=Game();side=1 if i%2==0 else -1
            while not g.winner:g.step(model.move(g,True) if g.turn==side else tactical(g,rng) if opponent=='tactical' else rng.choice(g.legal()))
            wins+=g.winner==side;draws+=g.winner==2;losses+=g.winner==-side
    return dict(wins=wins,draws=draws,losses=losses,score=(wins+draws*.5)/games)

def main():
    p=argparse.ArgumentParser();p.add_argument('--updates',type=int,default=200);p.add_argument('--batch',type=int,default=16);p.add_argument('--seed',type=int,default=17);args=p.parse_args()
    if args.updates<1 or args.batch<1:p.error('Positive budgets required')
    torch.set_num_threads(1);torch.manual_seed(args.seed);random.seed(args.seed)
    model=TacticalPolicy();opt=torch.optim.Adam(model.parameters(),lr=.02);pool=[copy.deepcopy(model)];best=copy.deepcopy(model)
    baseline=evaluate(model);best_score=baseline['score'];average=0.;start=time.time()
    for update in range(args.updates):
        records=[];rewards=[]
        for episode in range(args.batch):
            g=Game();side=random.choice([-1,1]);opp=random.choice(pool);opponent=random.choice(['tactical','tactical','self','random']);trajectory=[]
            while not g.winner:
                if g.turn==side:
                    a,d=model.distribution(g);k=d.sample();trajectory.append((d.log_prob(k),d.entropy()));action=a[int(k)]
                else:
                    with torch.no_grad():action=tactical(g,random) if opponent=='tactical' else random.choice(g.legal()) if opponent=='random' else opp.move(g)
                g.step(action)
            reward=0. if g.winner==2 else 1. if g.winner==side else -1.
            rewards.append(reward)
            records.extend((lp,en,(reward-average)*.99**(len(trajectory)-j-1)) for j,(lp,en) in enumerate(trajectory))
        loss=torch.stack([-lp*adv-.005*en for lp,en,adv in records]).mean();opt.zero_grad();loss.backward();nn.utils.clip_grad_norm_(model.parameters(),1.);opt.step();average=.95*average+.05*sum(rewards)/len(rewards)
        if (update+1)%25==0 or update+1==args.updates:
            pool.append(copy.deepcopy(model));pool=pool[-8:];score=evaluate(model)
            if score['score']>best_score:best=copy.deepcopy(model);best_score=score['score']
            print(json.dumps(dict(update=update+1,evaluation=score,elapsed=round(time.time()-start,1))),flush=True)
    report=dict(algorithm='REINFORCE with moving reward baseline and frozen-opponent pool',warm_start='handcrafted tactical priorities',seed=args.seed,updates=args.updates,batch=args.batch,baseline=baseline,selected_evaluation=evaluate(best),elapsed_seconds=time.time()-start,weights=best.weights.detach().tolist())
    out=Path('training/checkpoints');out.mkdir(exist_ok=True);torch.save(dict(type='tactical-linear-v1',weights=best.state_dict()),out/'tactical.pt')
    Path('public/policy.json').write_text(json.dumps(dict(type='tactical-linear-v1',weights=report['weights'])));Path('training/tactical-results.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=='__main__':main()
