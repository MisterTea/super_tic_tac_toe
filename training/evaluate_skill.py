"""Skill-strength curve and paired calibration metrics; no human-age claims."""
import argparse,json,random,time
from pathlib import Path
from game import Game
from skill import move
from evaluate import tactical
def main():
    p=argparse.ArgumentParser();p.add_argument('--games',type=int,default=100);p.add_argument('--seed',type=int,default=4567);p.add_argument('--skills',default='0,.25,.5,.75,1');args=p.parse_args()
    if args.games<2:p.error('At least two games required')
    skills=[float(k) for k in args.skills.split(',')]
    if any(not 0<=k<=1 for k in skills):p.error('Skill levels must lie in [0,1]')
    model=json.loads(Path('public/skill-policy.json').read_text());rows=[];start=time.time()
    for opponent in ['random','tactical']:
        for skill in skills:
            wins=draws=losses=0
            for i in range(args.games):
                rng=random.Random(args.seed+i);other=random.Random(args.seed+10000+i);g=Game();side=1 if i%2==0 else -1
                while not g.winner:g.step(move(g,skill,model,rng) if g.turn==side else other.choice(g.legal()) if opponent=='random' else tactical(g,other))
                wins+=g.winner==side;draws+=g.winner==2;losses+=g.winner==-side
            row=dict(skill=skill,opponent=opponent,games=args.games,wins=wins,draws=draws,losses=losses,score=(wins+.5*draws)/args.games);rows.append(row);print(json.dumps(row),flush=True)
    report=dict(seed=args.seed,benchmarks=rows,elapsed_seconds=time.time()-start,endpoint_engine_at_evaluation=model.get('championEngine','bounded or raw policy'),humanCalibrated=False,warning='Small baseline sweep is diagnostic, not evidence of average middle-school ability or monotonic skill.')
    Path('training/skill-evaluation.json').write_text(json.dumps(report,indent=2))
if __name__=='__main__':main()
