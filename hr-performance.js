export async function hrPerformanceReport(db,month){
  const [people,kpis,ready]=await Promise.all([
    db.prepare("SELECT username,full_name,role FROM trainer_users WHERE active=1 AND role IN ('agent','quality','trainer') ORDER BY full_name").all(),
    db.prepare("SELECT * FROM agent_kpi_monthly WHERE period_start=? AND (json_extract(details,'$.source')='ucm_api' OR (json_extract(details,'$.source')='kpi_analyzer')) AND total_calls>0").bind(month+'-01').all(),
    db.prepare('SELECT value FROM app_control WHERE key=?').bind('ucm_month_ready_'+month).first()
  ]);
  const byUser=new Map((kpis.results||[]).map(row=>{
    const kpi={...row};let details={};try{details=typeof row.details==='string'?JSON.parse(row.details):row.details||{}}catch{}
    for(const key of details.unavailable_scores||[])if(['quality','response','handling'].includes(key))kpi[key+'_score']=null;
    return [String(row.username).trim().toLowerCase(),kpi];
  }));
  return {month,basis:'Saved monthly performance for all employees. Past-month reports are uploaded by the administrator in KPI Analyzer; this screen does not query the UCM.',sync:{status:ready?.value==='complete'?'complete':'pending'},roster:(people.results||[]).map(user=>({...user,kpi:byUser.get(String(user.username).trim().toLowerCase())||null}))};
}
