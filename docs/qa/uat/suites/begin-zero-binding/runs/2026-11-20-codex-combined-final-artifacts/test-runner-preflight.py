import importlib.util,pathlib,unittest,itertools,json
from unittest.mock import patch
p=pathlib.Path(__file__).with_name('runner-pinned.py')
s=importlib.util.spec_from_file_location('pinned',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Group:
 def __init__(self,image,fail=False):self.image=image;self.fail=fail;self.problems=[]
 def call(self,*a,**kw):return {'httpStatus':200,'body':{'result':{}}}
 def query(self,name,**kw):
  self.problems.append(name)
  if self.fail and name=='r10-1-7-query':raise RuntimeError('unit-test-only synthetic sampler failure')
 def save(self,*a):pass
class Recorder:
 def save(self,*a):pass
class SamplerContract(unittest.TestCase):
 def test_control_identity_and_three_complete_rounds(self):
  a,b=Group('baseline'),Group('candidate')
  with patch.object(m.time,'monotonic',side_effect=itertools.count(0,.01)):
   r=m.Rig.compare_performance(Recorder(),a,b)
  self.assertEqual(r['status'],'PASS');self.assertEqual(r['baselineImage'],'baseline');self.assertEqual(r['candidateImage'],'candidate')
  self.assertEqual(len(r['rounds']),3);self.assertEqual(r['successes'],{'baseline':300,'candidate':300})
  self.assertEqual(len(a.problems),330);self.assertEqual(len(b.problems),330)
 def test_one_failure_is_retained_and_does_not_drop_remaining_denominator(self):
  a,b=Group('baseline'),Group('candidate',True)
  with patch.object(m.time,'monotonic',side_effect=itertools.count(0,.01)):
   r=m.Rig.compare_performance(Recorder(),a,b)
  self.assertEqual(r['status'],'FAIL');self.assertEqual(r['problemDenominatorPerGroup'],300);self.assertEqual(r['successes']['candidate'],299)
  self.assertEqual(len(b.problems),330);self.assertEqual(len(r['failures']),1)
if __name__=='__main__':unittest.main()
