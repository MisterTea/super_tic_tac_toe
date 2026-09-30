"""Player-relative spatial evidence and bounded cognition, mirrored in TypeScript."""
import math, random
from game import Game,LINES

def winning_actions(g):
    moves=set()
    for line in LINES:
        if sum(g.boards[b]==g.turn for b in line)!=2:continue
        for b in line:
            if g.boards[b]!=0:continue
            board=g.cells[b*9:b*9+9]
            for local in LINES:
                if sum(board[c]==g.turn for c in local)!=2:continue
                for c in local:
                    if board[c]==0:moves.add(b*9+c)
    return [a for a in g.legal() if a in moves]
def search_move(g,rng,simulations=700):
    actions=g.legal();wins=winning_actions(g)
    if wins:return wins[0]
    counts=[0]*len(actions);values=[0]*len(actions)
    for i in range(simulations):
        k=i%len(actions);t=Game(g.cells.copy(),g.boards.copy(),g.turn,g.forced,g.winner,g.moves.copy());t.step(actions[k])
        while not t.winner:
            a=t.legal();wins=winning_actions(t);t.step(wins[0] if wins else a[min(len(a)-1,int(rng.random()*len(a)))])
        counts[k]+=1;values[k]+=0 if t.winner==2 else 1 if t.winner==g.turn else -1
    return actions[max(range(len(actions)),key=lambda k:values[k]/counts[k])]

def center(b):return [b//3*3+1,b%3*3+1]
def fixation(g):
    if g.moves:
        a=g.moves[-1];b,c=a//9,a%9
        return [b//3*3+c//3,b%3*3+c%3]
    return [4,4] if g.forced<0 else center(g.forced)
def attention(distance,p):return math.exp(-p['decay']*max(0,distance-p['radius']))
def evidence(g,a,p,focus=None):
    f=focus or fixation(g)
    def notice(b):
        c=center(b);return attention(math.hypot(c[0]-f[0],c[1]-f[1]),p)
    local,route=notice(a//9),notice(a%9)
    ownership=[notice(i) for i,v in enumerate(g.boards) if abs(v)==1]
    macro=p['macro']*math.prod(ownership)
    return [local,local,local*macro,local*macro,route,route*macro,route,1,local*macro,local,local*macro,local]
def profile_at(model,skill):
    if not math.isfinite(skill):raise ValueError('Skill must be finite')
    k=max(0,min(1,skill));i=0
    while i<len(model['anchors'])-2 and k>model['anchors'][i+1]:i+=1
    t=(k-model['anchors'][i])/(model['anchors'][i+1]-model['anchors'][i])
    return {key:model['profiles'][i][key]*(1-t)+model['profiles'][i+1][key]*t for key in model['profiles'][i]}
def move(g,skill,model,rng=random,focus=None):
    if not math.isfinite(skill):raise ValueError('Skill must be finite')
    skill=max(0,min(1,skill))
    actions=g.legal()
    if not actions:raise ValueError('No legal moves')
    if skill==0:return actions[min(len(actions)-1,int(rng.random()*len(actions)))]
    if skill==1 and model.get('championEngine')=='monte-carlo-700':return search_move(g,rng)
    weights=model['expert']['weights']
    if skill==1 and not model.get('champion'):return max(actions,key=lambda a:sum(x*w for x,w in zip(g.action_features(a),weights)))
    p=model['champion'] if skill==1 and model.get('champion') else profile_at(model,skill);masks={};f=focus or fixation(g);macro=int(rng.random()<p['macro'])
    def observed(b):
        if b not in masks:
            c=center(b);masks[b]=int(rng.random()<attention(math.hypot(c[0]-f[0],c[1]-f[1]),p))
        return masks[b]
    def macro_noticed(t):return int(macro and all(abs(v)!=1 or observed(b)==1 for b,v in enumerate(t.boards)))
    def score(t,a):
        local,route=observed(a//9),observed(a%9)
        macro_seen=macro_noticed(t)
        gates=[local,local,local*macro_seen,local*macro_seen,route,route*macro_seen,route,1,local*macro_seen,local,local*macro_seen,local]
        return sum(x*w*v for x,w,v in zip(t.action_features(a),weights,gates))
    nodes=0
    def next_game(t,a):
        h=Game(t.cells.copy(),t.boards.copy(),t.turn,t.forced,t.winner,t.moves.copy());h.step(a);return h
    def walk(t,depth):
        nonlocal nodes
        if t.winner:return 0 if t.winner==2 or not macro_noticed(t) else -1000
        if depth<=0 or nodes>=400:return 0
        ranked=sorted([(a,score(t,a)) for a in t.legal()],key=lambda x:-x[1])[:max(1,math.floor(p['breadth']+.5))]
        best=-math.inf
        for a,v in ranked:
            if nodes>=400:break
            nodes+=1;best=max(best,v-(walk(next_game(t,a),depth-1) if depth>1 else 0))
        return best
    depth=max(1,math.floor(p['depth'])+int(rng.random()<p['depth']%1))
    candidates=sorted([(a,score(g,a),rng.random()) for a in actions],key=lambda x:(-x[1],x[2]))[:max(1,math.floor(p['breadth']+.5))]
    scores=[]
    for a,value,_ in candidates:
        nodes=0;scores.append((a,value-(walk(next_game(g,a),depth-1) if depth>1 else 0)))
    best=max(v for _,v in scores);ties=[a for a,v in scores if abs(v-best)<1e-9]
    return ties[min(len(ties)-1,int(rng.random()*len(ties)))]
