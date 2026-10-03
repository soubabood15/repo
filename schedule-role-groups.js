/* Shared display grouping only: schedule keys and permissions are unchanged. */
globalThis.ScheduleRoleGroups = Object.freeze({
  group(users) {
    const groups = new Map();
    const labels = {agent:'Agents',quality:'Quality',trainer:'Trainers',supervisor:'Supervisors'};
    for (const user of users) {
      const role = String(user.role || 'agent').trim().toLowerCase() || 'agent';
      if (role === 'admin') continue;
      if (!groups.has(role)) groups.set(role, {
        role,
        label: labels[role] || role.replace(/\b\w/g, letter => letter.toUpperCase()),
        users: []
      });
      groups.get(role).users.push(user);
    }
    const priority = role => role === 'agent' ? 0 : role === 'quality' ? 1 : 2;
    return [...groups.values()].sort((a,b) => priority(a.role)-priority(b.role) || a.label.localeCompare(b.label));
  }
});
