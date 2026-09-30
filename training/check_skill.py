import json,sys
from game import Game
from skill import move,evidence,profile_at
model=json.load(open('public/skill-policy.json'))
class RNG:
    def __init__(self,seed):self.seed=seed
    def random(self):
        self.seed=(self.seed*1664525+1013904223)&0xffffffff
        return self.seed/4294967296
out=[]
for row in json.load(sys.stdin):
    g=Game()
    for a in row['moves']:g.step(a)
    p=profile_at(model,row['skill'])
    out.append(dict(action=move(g,row['skill'],model,RNG(row['seed'])),profile=p,evidence=[evidence(g,a,p) for a in g.legal()]))
json.dump(out,sys.stdout)
