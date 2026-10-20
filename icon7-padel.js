// Booking uses the authenticated portal queue; admin remains a static design reference.
const workspace = document.getElementById('padelWorkspace');
const frame = document.getElementById('padelFrame');
const tabs = [...document.querySelectorAll('[data-padel-view]')];
for (const tab of tabs) {
  tab.addEventListener('click', () => {
    const admin = tab.dataset.padelView === 'admin';
    frame.setAttribute('sandbox', admin ? '' : 'allow-scripts allow-same-origin allow-forms');
    frame.src = admin ? 'icon7-padel/admin.html' : 'icon7-padel/user.html';
    frame.title = admin ? 'معاينة واجهة إدارة حجوزات الباديل' : 'حجز الباديل لدى أيكون';
    for (const button of tabs) button.setAttribute('aria-selected', String(button === tab));
  });
}
document.getElementById('padelOpen').addEventListener('click', () => {
  if (!window.currentUser) return;
  workspace.hidden = false;
  if (!frame.getAttribute('src')) frame.src = 'icon7-padel/user.html';
  workspace.scrollIntoView({behavior:'smooth', block:'start'});
});
document.getElementById('padelClose').addEventListener('click', () => {
  workspace.hidden = true;
  document.getElementById('padelOpen').focus();
});
