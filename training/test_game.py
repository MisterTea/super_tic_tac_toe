import random, unittest
from game import Game, result, macro_result, winning_line
class Rules(unittest.TestCase):
    def test_routing(self):
        g=Game();g.step(40);self.assertEqual(g.forced,4);self.assertEqual(len(g.legal()),8)
        with self.assertRaises(ValueError):g.step(0)
    def test_games(self):
        for _ in range(100):
            g=Game()
            while not g.winner:g.step(random.choice(g.legal()))
            h=Game()
            for a in g.moves:h.step(a)
            self.assertEqual(g,h)
            self.assertIn(g.winner,(-1,1))
    def test_wildcards(self):
        for player in (-1,1):
            g=Game(boards=[0,-1,0,1,0,1,0,-1,0],turn=player,forced=4)
            g.cells[36:45]=[v*player for v in [1,-1,1,1,-1,-1,-1,1,0]]
            self.assertEqual(g.action_features(44)[2],1)
            g.step(44)
            self.assertEqual(g.boards[4],2)
            self.assertEqual(g.winner,player)
            self.assertTrue(winning_line(g.boards,1))
            self.assertTrue(winning_line(g.boards,-1))
        self.assertEqual(macro_result([1,1,2,0,0,0,0,0,0],-1),1)
        self.assertEqual(macro_result([2,2,2,0,0,0,0,0,0],-1),-1)
    def test_final_score(self):
        self.assertEqual(macro_result([1,-1,1,-1,-1,1,-1,1,-1],1),-1)
        self.assertEqual(macro_result([1,-1,1,1,-1,-1,-1,1,2],-1),1)
    def test_closed(self):
        g=Game();g.boards[4]=2;g.step(4);self.assertEqual(g.forced,-1)
if __name__=='__main__':unittest.main()
