"""Deterministic PyTorch output references for actual browser WASM inference tests."""
import json,math,random
from pathlib import Path
import torch
from game import Game
from skill import center,fixation
from export_browser import BrowserPolicy
torch.set_num_threads(1)
model=BrowserPolicy(json.loads(Path('public/skill-policy.json').read_text())).eval()
g=Game();states=[];rng=random.Random(73)
for i in range(21):
    if i in [0,1,20]:
        states.append(Game(g.cells.copy(),g.boards.copy(),g.turn,g.forced,g.winner,g.moves.copy()))
    if not g.winner:g.step(rng.choice(g.legal()))
rows=[]
with torch.no_grad():
    for g in states:
        for level in range(1,11):
            actions=g.legal();f=fixation(g)
            x=[[0.]*12 for _ in range(81)]
            for a in actions:x[a]=g.action_features(a)
            inputs=dict(features=[v for row in x for v in row],skill=[level/10],distances=[math.hypot(center(b)[0]-f[0],center(b)[1]-f[1]) for b in range(9)],ownership=[float(abs(v)==1) for v in g.boards],noise=[rng.random() for _ in range(10)],legal_mask=[0. if a in actions else -1e9 for a in range(81)],terminal=[0.])
            args=[torch.tensor(inputs[k]).reshape(81,12) if k=='features' else torch.tensor(inputs[k]) for k in inputs]
            outputs=model(*args)
            rows.append(dict(inputs=inputs,expected=dict(zip(['logits','profile','terminal_value'],[v.tolist() for v in outputs]))))
Path('e2e/fixtures').mkdir(exist_ok=True)
Path('e2e/fixtures/browser-policy.json').write_text(json.dumps(rows))
print(f'Saved {len(rows)} browser/PyTorch references')
