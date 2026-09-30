import random, unittest
from game import Game, result
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
    def test_closed(self):
        g=Game();g.boards[4]=2;g.step(4);self.assertEqual(g.forced,-1)
if __name__=='__main__':unittest.main()
