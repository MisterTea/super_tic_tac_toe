"""Independent rules engine. Actions are board * 9 + square."""
from dataclasses import dataclass, field
LINES = ((0,1,2),(3,4,5),(6,7,8),(0,3,6),(1,4,7),(2,5,8),(0,4,8),(2,4,6))
def result(c):
    for a,b,d in LINES:
        if abs(c[a]) == 1 and c[a] == c[b] == c[d]: return c[a]
    return 2 if all(c) else 0
def winning_line(boards, player):
    return next((line for line in LINES if all(boards[b] in (player,2) for b in line)), None)
def score_winner(boards):
    return -1 if boards.count(-1)>boards.count(1) else 1
def macro_result(boards, mover):
    if winning_line(boards,mover):return mover
    if winning_line(boards,-mover):return -mover
    return score_winner(boards) if all(boards) else 0
@dataclass
class Game:
    cells: list = field(default_factory=lambda: [0]*81)
    boards: list = field(default_factory=lambda: [0]*9)
    turn: int = 1
    forced: int = -1
    winner: int = 0
    moves: list = field(default_factory=list)
    def legal(self):
        return [] if self.winner else [a for a in range(81) if not self.cells[a] and not self.boards[a//9] and (self.forced < 0 or a//9 == self.forced)]
    def step(self,a):
        if a not in self.legal(): raise ValueError('Illegal move')
        self.cells[a]=self.turn
        b=a//9
        self.boards[b]=result(self.cells[b*9:b*9+9])
        self.forced=-1 if self.boards[a%9] else a%9
        self.winner=macro_result(self.boards,self.turn)
        self.turn=-self.turn
        self.moves.append(a)
    def features(self):
        return [float(x==self.turn) for x in self.cells]+[float(x==-self.turn) for x in self.cells]+[float(self.forced<0 or self.forced==b) for b in range(9)]
    def action_features(self,a):
        b,c,p=a//9,a%9,self.turn
        board=self.cells[b*9:b*9+9]
        blocking=sum(c in line and sum(board[i]==-p for i in line)==2 for line in LINES)
        potential=sum(c in line and not any(board[i]==-p for i in line) and any(board[i]==p for i in line) for line in LINES)/4
        board[c]=p
        won=result(board)==p;macro=self.boards.copy();macro[b]=result(board)
        def threat(v,index,player):
            return any(index in line and sum(v[i] in (player,2) for i in line)==2 and sum(v[i]==0 for i in line)==1 for line in LINES)
        closed=macro[c]!=0
        target=board if b==c else self.cells[c*9:c*9+9]
        danger=not closed and any(sum(target[i]==-p for i in line)==2 and sum(target[i]==0 for i in line)==1 for line in LINES)
        macro_potential=sum(b in line and not any(self.boards[i]==-p for i in line) and any(self.boards[i] in (p,2) for i in line) for line in LINES)/4
        return list(map(float,[won,blocking>0,macro_result(macro,p)==p,won and threat(self.boards,b,-p),danger,danger and threat(macro,c,-p),closed,c==4,won and b==4,potential,won*macro_potential,blocking/2]))
