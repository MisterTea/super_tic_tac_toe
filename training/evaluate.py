"""Repeatable policy benchmarks, separate from optimizer updates."""
import argparse, copy, json, math, random
import torch
from game import Game, LINES
from train import Policy, distribution

def tactical(g,rng):
    actions=g.legal();scores=[]
    for a in actions:
        t=copy.deepcopy(g);t.step(a)
        score=100 if t.winner==g.turn else 0
        score+=5 if t.boards[a//9]==g.turn else 0
        board=g.cells[(a//9)*9:(a//9+1)*9]
        for line in LINES:
            if a%9 in line and sum(board[c]==-g.turn for c in line)==2:score+=3
        if a%9==4:score+=.2
        if t.forced>=0:
            target=t.cells[t.forced*9:t.forced*9+9]
            if any(sum(target[c]==-g.turn for c in line)==2 and sum(target[c]==0 for c in line)==1 for line in LINES):score-=2
        scores.append(score)
    best=max(scores)
    return rng.choice([a for a,s in zip(actions,scores) if s==best])

def benchmark(model,games,seed,opponent):
    rng=random.Random(seed);points=[];wins=draws=losses=0
    with torch.no_grad():
        for i in range(games):
            g=Game();side=1 if i%2==0 else -1
            while not g.winner:
                if g.turn==side:a=model.move(g,True) if hasattr(model,'move') else int(distribution(model,g)[0].logits.argmax())
                elif opponent=='random':a=rng.choice(g.legal())
                else:a=tactical(g,rng)
                g.step(a)
            wins+=g.winner==side;draws+=g.winner==2;losses+=g.winner==-side
            points.append(.5 if g.winner==2 else float(g.winner==side))
    score=sum(points)/games
    se=math.sqrt(sum((x-score)**2 for x in points)/(games-1)/games) if games>1 else 0
    return dict(opponent=opponent,games=games,wins=wins,draws=draws,losses=losses,score=score,approximate_95_percent_interval=[max(0,score-1.96*se),min(1,score+1.96*se)])

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--checkpoint',default='training/checkpoints/policy.pt');p.add_argument('--games',type=int,default=300);p.add_argument('--seed',type=int,default=12345);p.add_argument('--output',default='training/evaluation.json');args=p.parse_args()
    if args.games<2:p.error('At least two games are required')
    torch.set_num_threads(1);checkpoint=torch.load(args.checkpoint,weights_only=True)
    if checkpoint.get('type')=='tactical-linear-v1':
        from train_tactical import TacticalPolicy
        model=TacticalPolicy();model.load_state_dict(checkpoint['weights'])
    else:
        model=Policy();model.load_state_dict(checkpoint['model'])
    report=dict(seed=args.seed,policy='greedy masked actor',benchmarks=[benchmark(model,args.games,args.seed,opponent) for opponent in ['random','tactical']],limitation='Tactical baseline is a shallow heuristic, not a search engine or human skill rating.')
    text=json.dumps(report,indent=2);open(args.output,'w').write(text);print(text)
