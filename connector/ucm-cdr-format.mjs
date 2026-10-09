// Documented Grandstream CDR JSON can be returned directly without API status.
export function cdrGroups(payload){
  const value=payload?.response??payload?.data??payload;
  if(Array.isArray(value))return value;
  for(const key of ['cdr_root','records','cdr'])if(Array.isArray(value?.[key]))return value[key];
  if(value?.cdr&&typeof value.cdr==='object')return [value.cdr];
  if(value&&typeof value==='object'&&(value.main_cdr||((value.session||value.AcctId||value.acctid||value.uniqueid||value.call_id||typeof value.cdr==='string')&&(value.start||value.start_time||value.calldate))))return [value];
  throw Object.assign(new Error('UCM_CDR_RESPONSE_UNSUPPORTED'),{code:'UCM_CDR_RESPONSE_UNSUPPORTED'});
}
export function flattenCdrPayload(payload){
  return cdrGroups(payload).flatMap(item=>{
    const session=item.session||(typeof item.cdr==='string'?item.cdr:null);
    if(!item.main_cdr)return [{...item,...(session?{session}:{})}];
    const numbered=Object.keys(item).filter(key=>/^sub_cdr_\d+$/.test(key)).sort((a,b)=>Number(a.slice(8))-Number(b.slice(8))).map(key=>item[key]);
    const details=Array.isArray(item.sub_cdr)?item.sub_cdr:numbered;
    // main_cdr is a summary; detailed legs replace it rather than count twice.
    return (details.length?details:[item.main_cdr]).map(row=>({...row,session:session||row.session}));
  });
}
