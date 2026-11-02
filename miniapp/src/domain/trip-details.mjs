const dateValue = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function tripEndDate(startDate, days) {
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('行程应为1–30天');
  if (!startDate) return '';
  if (!dateValue(startDate)) throw new Error('请输入有效日期');
  const end = new Date(`${startDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + days - 1);
  return end.toISOString().slice(0, 10);
}

export function validateTripDetails(value, days) {
  const title = String(value.title || '').trim(), destination = String(value.destination || '').trim();
  const startDate = String(value.startDate || ''), endDate = tripEndDate(startDate, days);
  const travelers = Number(value.travelers ?? 0), budget = Number(value.budget ?? 0), userNotes = String(value.userNotes || '').trim();
  if (!title || title.length > 80 || !destination || destination.length > 60) throw new Error('请填写行程名称和目的地，名称最多80字，目的地最多60字');
  if (value.endDate !== undefined && value.endDate !== endDate) throw new Error('返程日期应与现有每日安排一致');
  if (!Number.isInteger(travelers) || travelers < 0 || travelers > 20) throw new Error('同行人数应为1–20人，暂不确定可留空');
  if (!Number.isFinite(budget) || budget < 0 || budget > 100000000) throw new Error('请输入有效总预算，暂不确定可留空');
  if (userNotes.length > 2000) throw new Error('出行备注最多2000字');
  return { title, destination, startDate, endDate, travelers, budget, userNotes };
}

export function formatTripText(trip) {
  const lines = [trip.title, `目的地：${trip.destination}`, trip.sample ? '【示例行程】' : '【行程草稿】',
    trip.startDate ? `日期：${trip.startDate} 至 ${trip.endDate}` : '日期：待定',
    trip.travelers ? `人数：${trip.travelers}人` : '人数：待定', trip.budget ? `计划总预算：人民币${trip.budget}元` : '预算：待定'];
  trip.days.forEach((activities, index) => {
    let date = '';
    if (trip.startDate) date = tripEndDate(trip.startDate, index + 1);
    lines.push('', `Day ${index + 1}${date ? ` · ${date}` : ''}`);
    activities.forEach((activity) => {
      lines.push(`${activity.time}｜${activity.title}`);
      if (activity.place?.address) lines.push(`地址：${activity.place.address}`);
      if (activity.detail) lines.push(activity.detail);
    });
  });
  if (trip.userNotes) lines.push('', '出行备注', trip.userNotes);
  if (trip.notes) lines.push('', '原回复附注（原始日期与实时信息需重新确认）', trip.notes);
  lines.push('', '此为行程安排，开放时间、价格与预订情况请在出行前核实。');
  const text = lines.join('\n');
  if (text.length > 50000) throw new Error('行程内容过长，请缩短备注后再复制');
  return text;
}
