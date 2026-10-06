export function attendanceExportRows(report){
  const serial=value=>value?Date.parse(value)/86400000+25569+3/24:null;
  return report.rows.filter(row=>row.shift||row.attendance).map(row=>({
    Employee:String(row.full_name),Username:String(row.username),Role:String(row.role),Date:serial(row.day+'T00:00:00+03:00'),Shift:row.shift,
    Status:row.status.replaceAll('_',' '),'Check-in (Amman)':serial(row.attendance?.punch_in),'Check-out (Amman)':serial(row.attendance?.punch_out),
    'Missing check-out':row.missing_check_out?'Yes':'No','Late minutes':row.late_minutes,'Worked minutes':row.work_minutes,'Required minutes':row.required_minutes,'Approved leave minutes':row.approved_leave_minutes
  }));
}
export function downloadAttendanceExcel(report,XLSX=globalThis.XLSX){
  if(!XLSX)throw Error('Excel export is unavailable. Reload and try again.');
  const sheet=XLSX.utils.json_to_sheet(attendanceExportRows(report));
  const range=sheet['!ref']?XLSX.utils.decode_range(sheet['!ref']):null;
  if(range)for(let r=1;r<=range.e.r;r++)for(const [c,format] of [[3,'dd mmm yyyy'],[6,'dd mmm yyyy hh:mm'],[7,'dd mmm yyyy hh:mm']]){const cell=sheet[XLSX.utils.encode_cell({r,c})];if(cell?.t==='n')cell.z=format}
  sheet['!cols']=[{wch:30},{wch:16},{wch:12},{wch:16},{wch:19},{wch:22},{wch:24},{wch:24},...Array.from({length:5},()=>({wch:23}))];
  if(range)sheet['!autofilter']={ref:sheet['!ref']};
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Attendance');XLSX.writeFile(book,'NEWTEL-Attendance-'+report.month+'.xlsx');
}
