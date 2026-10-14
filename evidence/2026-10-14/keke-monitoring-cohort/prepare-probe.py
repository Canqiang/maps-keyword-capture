import copy,datetime,json,pathlib,subprocess
P=pathlib.Path(__file__).parent
state=json.loads((P/'acr-build-state.json').read_text());assert state['status']=='Succeeded'
build=json.loads((P/'build-request.json').read_text())
image=json.loads(subprocess.check_output(['az','acr','repository','show','--name','FBRDevAcr','--image','ai/maps-keyword-capture:'+build['tag'],'--query','{digest:digest,name:name}','-o','json'],text=True))
digest=image['digest'];assert len(digest)==71 and digest.startswith('sha256:')
full='fbrdevacr.azurecr.io/ai/maps-keyword-capture@'+digest
old=json.loads((P/'cronjob-before.json').read_text());cfg=json.loads((P/'monitor-proposed.json').read_text())
cm_name='maps-keyword-monitor-keke-20261014-v1';stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dt%H%M%Sz');job_name='maps-keke-cohort-verify-'+stamp;probe_name='maps-keke-probe-'+stamp
cm={'apiVersion':'v1','kind':'ConfigMap','metadata':{'name':cm_name,'namespace':'uat','labels':{'app.kubernetes.io/name':'maps-keyword-monitor','app.kubernetes.io/component':'config'}},'immutable':True,'data':{'monitor.json':json.dumps(cfg,ensure_ascii=False,indent=2)+'\n'}}
probe={'apiVersion':'v1','kind':'ConfigMap','metadata':{'name':probe_name,'namespace':'uat'},'immutable':True,'data':{k:(P/k).read_text() for k in ['verify-runtime.mjs','monitor-before.json','smoke-config.json']}}
spec=copy.deepcopy(old['spec']['jobTemplate']['spec']);spec['activeDeadlineSeconds']=900
spec['template']['metadata']={'labels':{'app.kubernetes.io/name':'maps-keyword-monitor','app.kubernetes.io/component':'cohort-validation'}}
pod=spec['template']['spec'];assert len(pod['containers'])==1
c=pod['containers'][0];c['image']=full;c['args']=['node','/probe/verify-runtime.mjs']
for e in c['env']:
 if e['name']=='IMAGE_DIGEST':e['value']=digest
for v in pod['volumes']:
 if v['name']=='config':v['configMap']['name']=cm_name
pod['volumes'].append({'name':'probe','configMap':{'name':probe_name}});c['volumeMounts'].append({'name':'probe','mountPath':'/probe','readOnly':True})
job={'apiVersion':'batch/v1','kind':'Job','metadata':{'name':job_name,'namespace':'uat','labels':{'app.kubernetes.io/name':'maps-keyword-monitor','app.kubernetes.io/component':'cohort-validation'}},'spec':spec}
for name,data in [('candidate-configmap',cm),('probe-configmap',probe),('probe-job',job)]: (P/(name+'.json')).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
(P/'launch-plan.json').write_text(json.dumps({'image':full,'digest':digest,'runtimeCommit':build['commit'],'job':job_name,'configMap':cm_name,'probeConfigMap':probe_name,'probeKeywords':json.loads((P/'smoke-keywords.json').read_text()),'scope':'all discovered store selection only, then three standalone queries; no daily claim'},indent=2)+'\n')
print(json.dumps({'prepared':True,'job':job_name,'image':full}))
