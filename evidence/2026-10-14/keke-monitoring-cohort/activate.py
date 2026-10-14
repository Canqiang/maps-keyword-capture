"""Promote only the accepted Keke monitor image and immutable config; no shared source write."""
import copy,datetime,json,pathlib,subprocess,sys
P=pathlib.Path(__file__).parent
base=['kubectl','--context','FBRDevAKSCluster','-n','uat']
def get(kind,name): return json.loads(subprocess.check_output(base+['get',kind]+([name] if name else [])+['-o','json'],text=True))
def save(name,obj): (P/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
plan=json.loads((P/'launch-plan.json').read_text());accepted=json.loads((P/'probe-acceptance.json').read_text())
assert accepted['accepted'] is True and accepted['image']==plan['image'] and accepted['runtimeCommit']==plan['runtimeCommit']
assert accepted['job']==plan['job'] and accepted['configMap']==plan['configMap']
assert accepted['podExitCode']==0 and accepted['selectionCheckedStores']>1 and accepted['verifiedObjects']>0 and accepted['visualSampleCount']==3
before=json.loads((P/'cronjob-before.json').read_text());cm_before=json.loads((P/'configmap-before.json').read_text())
current=get('cronjob',before['metadata']['name']);assert current['metadata']['uid']==before['metadata']['uid'];assert current['spec']==before['spec'];assert not current.get('status',{}).get('active')
old_cm=get('configmap',cm_before['metadata']['name']);assert old_cm['metadata']['uid']==cm_before['metadata']['uid'] and old_cm['data']==cm_before['data']
cm=get('configmap',plan['configMap']);assert cm['immutable'] is True and cm['metadata']['uid']==accepted['configMapUid']
assert json.loads(cm['data']['monitor.json'])==json.loads((P/'monitor-proposed.json').read_text())
pods=get('pods','')['items']
assert not [p for p in pods if p['metadata'].get('labels',{}).get('app.kubernetes.io/name')=='maps-keyword-monitor' and p.get('status',{}).get('phase') in ['Pending','Running']]
job=get('job',plan['job']);assert job['metadata']['uid']==accepted['jobUid'];assert any(c['type']=='Complete' and c['status']=='True' for c in job.get('status',{}).get('conditions',[]))
expected=copy.deepcopy(current['spec']);pod=expected['jobTemplate']['spec']['template']['spec'];assert len(pod['containers'])==1
c=pod['containers'][0];env_index=next(i for i,e in enumerate(c['env']) if e['name']=='IMAGE_DIGEST');volume_index=next(i for i,v in enumerate(pod['volumes']) if v['name']=='config')
c['image']=plan['image'];c['env'][env_index]['value']=plan['digest'];pod['volumes'][volume_index]['configMap']['name']=plan['configMap']
root='/spec/jobTemplate/spec/template/spec'
patch=[{'op':'test','path':'/metadata/uid','value':current['metadata']['uid']},{'op':'test','path':'/metadata/resourceVersion','value':current['metadata']['resourceVersion']},{'op':'test','path':'/spec','value':current['spec']},{'op':'replace','path':root+'/containers/0/image','value':plan['image']},{'op':'replace','path':root+f'/containers/0/env/{env_index}/value','value':plan['digest']},{'op':'replace','path':root+f'/volumes/{volume_index}/configMap/name','value':plan['configMap']}]
save('activation-patch.json',patch);save('activation-expected-spec.json',expected)
if '--apply' not in sys.argv:
 print(json.dumps({'ready':True,'changedPaths':[x['path'] for x in patch if x['op']=='replace']}));sys.exit(0)
subprocess.run(base+['patch','cronjob',current['metadata']['name'],'--type=json','--patch-file',str(P/'activation-patch.json'),'-o','name'],check=True)
after=get('cronjob',current['metadata']['name']);save('cronjob-after.json',after);assert after['spec']==expected
new_cm=get('configmap',plan['configMap']);assert new_cm['data']==cm['data'] and new_cm['immutable'] is True
now=datetime.datetime.now(datetime.timezone.utc)
save('activation.json',{'activated':True,'checkedAt':now.isoformat(),'image':plan['image'],'runtimeCommit':plan['runtimeCommit'],'configMap':plan['configMap'],'cohortId':'keke-acquisition-20261014-v1','cronjobUid':after['metadata']['uid'],'schedule':after['spec']['schedule'],'timeZone':after['spec']['timeZone'],'suspend':after['spec'].get('suspend',False),'changedPaths':[x['path'] for x in patch if x['op']=='replace'],'oldImage':current['spec']['jobTemplate']['spec']['template']['spec']['containers'][0]['image'],'oldConfigMap':cm_before['metadata']['name'],'sharedKeywordSourceWritePerformed':False,'scope':'Configuration active for future Jobs; all-store selection and 3-query smoke verified; first full scheduled cohort cycle not yet observed'})
print(json.dumps({'activated':True,'checkedAt':now.isoformat(),'cohort':'keke-acquisition-20261014-v1'}))
