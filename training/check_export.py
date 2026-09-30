import json, sys, torch
from game import Game
from train import Policy, distribution
weights=json.load(open('public/policy.json'))
if weights.get('type')=='tactical-linear-v1':
    from train_tactical import TacticalPolicy
    model=TacticalPolicy()
    with torch.no_grad():model.weights.copy_(torch.tensor(weights['weights']))
    actions=[]
    with torch.no_grad():
        for moves in json.load(sys.stdin):
            g=Game()
            for a in moves:g.step(a)
            actions.append(model.move(g,True))
    json.dump(actions,sys.stdout);sys.exit(0)
model=Policy()
with torch.no_grad():
    model.hidden.weight.copy_(torch.tensor(weights['w1']));model.hidden.bias.copy_(torch.tensor(weights['b1']))
    model.actor.weight.copy_(torch.tensor(weights['w2']));model.actor.bias.copy_(torch.tensor(weights['b2']))
    actions=[]
    for moves in json.load(sys.stdin):
        g=Game()
        for a in moves:g.step(a)
        actions.append(int(distribution(model,g)[0].logits.argmax()))
json.dump(actions,sys.stdout)
