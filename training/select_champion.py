"""Select the full-attention endpoint from the available bounded planners on a validation seed."""
import argparse,copy,json,random,time
from pathlib import Path
from game import Game
from skill import move
from evaluate import tactical
def score(model,games,seed):
    wins=draws=losses=0
    for i in range(games):
        rng=random.Random(seed+i);opp=random.Random(seed+10000+i);g=Game();side=1 if i%2==0 else -1
        while not g.winner:g.step(move(g,1,model,rng) if g.turn==side else tactical(g,opp))
        wins+=g.winner==side;draws+=g.winner==2;losses+=g.winner==-side
    return dict(wins=wins,draws=draws,losses=losses,score=(wins+.5*draws)/games)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--games',type=int,default=60);p.add_argument('--seed',type=int,default=8801);args=p.parse_args()
    model=json.loads(Path('public/skill-policy.json').read_text());model.pop('champion',None);model.pop('championEngine',None);best=copy.deepcopy(model);rows=[];best_score=-1;start=time.time()
    for depth,breadth in [(0,0),(2,4),(3,6),(4,8)]:
        candidate=copy.deepcopy(model)
        if depth:candidate['champion']=dict(radius=12.,decay=0.,macro=1.,depth=float(depth),breadth=float(breadth))
        result=score(candidate,args.games,args.seed);row=dict(depth=depth,breadth=breadth,**result);rows.append(row);print(json.dumps(row),flush=True)
        if result['score']>best_score:best_score=result['score'];best=candidate
    if best.get('champion'):
        for profile in best['profiles']:
            profile['depth']=min(profile['depth'],best['champion']['depth']);profile['breadth']=min(profile['breadth'],best['champion']['breadth'])
        best['profiles'][-1]=copy.deepcopy(best['champion'])
    Path('public/skill-policy.json').write_text(json.dumps(best,indent=2));Path('training/champion-selection.json').write_text(json.dumps(dict(seed=args.seed,games_per_candidate=args.games,candidates=rows,selected=best.get('champion','raw policy'),elapsed_seconds=time.time()-start),indent=2))
