import { useState } from 'react';
import type { Demand } from './TestDemand';
export const healthLabel=(d:Demand)=>d.health_status==='DATA_HEALTH_VERIFIED'?'Health Verified':d.health_status==='REPAIR_PENDING_VERIFICATION'?'Repair Pending Verification':d.violations?`${d.violations} Violations · ${d.policy?'Repair Available':'Guided Repair'}`:'Health Review';
type HealthPlan={token:string;affected_entities:number;total_physical_rows:number;physical_rows:Record<string,number>;sql:string;note:string};
export function HealthRepair({data,onChange,onRun}:{data:Demand;onChange:()=>Promise<void>;onRun:()=>Promise<void>}){
 const [plan,setPlan]=useState<HealthPlan|null>(null),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function post(action:string,token?:string){const r=await fetch('/api/test-demand/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({domain:data.domain,...(token?{token}:{})})});const result=await r.json();if(!r.ok)throw new Error(result.message||'Health repair unavailable');return result;}
 async function act(job:()=>Promise<void>){setBusy(true);setError('');try{await job();}catch(e){setError((e as Error).message);setPlan(null);setConfirm(false);}finally{setBusy(false);}}
 return <section className="test-demand health-repair" role="region" aria-label="DATA HEALTH & REPAIR"><h3>DATA HEALTH</h3><h4>{data.label}</h4>
 <div className={`qa-primary qa-${data.health_status==='DATA_HEALTH_VERIFIED'?'met':'review'}`} data-health-status={data.health_status}>{healthLabel(data)}</div>
 <dl><div><dt>Current violations</dt><dd>{data.violations?.toLocaleString('en-US')}</dd></div><div><dt>Allowed violations</dt><dd>{data.allowed}</dd></div><div><dt>Rule</dt><dd>{data.rule_key}</dd></div></dl>
 <p><strong>Repair policy:</strong> {data.policy?.description||'No automated correction policy. Review with the data owner before choosing a correction.'}</p>
 <p>Health correction fixes invalid TEST states. Confirm the explicit policy and affected rows before applying.</p>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{!data.fresh&&<p>TEST changed. Re-run analysis before another correction.</p>}
 <div className="demand-actions">{data.capability==='HEALTH_REPAIR_AUTOMATED'&&data.fresh&&!!data.violations&&<button disabled={busy} onClick={()=>void act(async()=>{setPlan(await post('health-preview'));setConfirm(false);})}>Preview Repair</button>}
 <button disabled={busy} onClick={()=>void act(async()=>{await onRun();await onChange();setPlan(null);setNotice('Health target re-evaluated from fresh analysis.');})}>Re-run Analysis</button></div>
 {plan&&<div className="repair-plan"><h4>Health correction plan</h4><p>{plan.affected_entities} affected business entities · {plan.total_physical_rows} physical rows · Target: {data.allowed} violations</p><ul>{Object.entries(plan.physical_rows).map(([table,n])=><li key={table}>{n} {table} rows</li>)}</ul><p>{data.policy?.description}</p><details><summary>Preview SQL</summary><p>{plan.note}</p><pre>{plan.sql}</pre></details><label className="repair-confirm"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>I approve this correction policy and row impact for TEST.</label><button disabled={busy||!confirm} onClick={()=>void act(async()=>{await post('health-apply',plan.token);setPlan(null);setConfirm(false);setNotice('Health repair applied. Re-run Analysis to verify the target.');await onChange();})}>Apply Health Repair</button></div>}
 {data.health_status==='DATA_HEALTH_VERIFIED'&&<p>DATA HEALTH VERIFIED · a fresh analysis measured the allowed violation target.</p>}
 </section>;
}
