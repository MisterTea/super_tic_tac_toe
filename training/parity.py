import json, sys
from game import Game
games=[]
for moves in json.load(sys.stdin):
    g=Game();states=[]
    for action in moves+[None]:
        states.append(dict(cells=g.cells.copy(),boards=g.boards.copy(),turn=g.turn,forced=g.forced,winner=g.winner,legal=g.legal(),features=g.features(),actionFeatures=[g.action_features(a) for a in g.legal()]))
        if action is not None:g.step(action)
    games.append(states)
json.dump(games,sys.stdout)
