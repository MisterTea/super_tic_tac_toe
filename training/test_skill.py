import copy,json,random,unittest
from pathlib import Path
from game import Game
from skill import attention,profile_at,move
from train_skill import human_fit
class SkillTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.model=json.loads(Path('public/skill-policy.json').read_text())
    def test_endpoints(self):
        g=Game();weights=self.model['expert']['weights']
        raw=copy.deepcopy(self.model);raw.pop('champion',None);raw.pop('championEngine',None)
        self.assertEqual(move(g,1,raw),max(g.legal(),key=lambda a:sum(x*w for x,w in zip(g.action_features(a),weights))))
        counts={a:0 for a in g.legal()};rng=random.Random(9)
        for _ in range(8100):counts[move(g,0,self.model,rng)]+=1
        self.assertLess(sum((n-100)**2/100 for n in counts.values()),140)
    def test_attention(self):
        p=profile_at(self.model,.5)
        self.assertEqual(attention(p['radius'],p),1)
        self.assertLess(attention(7,p),attention(3,p))
    def test_human_fit_changes_cognitive_parameters_when_examples_require_it(self):
        # Mechanical fixture, not an actual human sample or calibration claim.
        g=Game();g.step(40);rows=[(g,36,.5)]
        fitted,report=human_fit(copy.deepcopy(self.model),rows,8)
        self.assertLessEqual(report['after_nll'],report['before_nll'])
        for key in ['radius','macro','depth','breadth']:
            values=[p[key] for p in fitted['profiles']]
            self.assertEqual(values,sorted(values))
if __name__=='__main__':unittest.main()
