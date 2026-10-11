// Estadísticas a partir del historial de sesiones completadas.
// Cada entrada del historial: { date: ISO string, title, focus, level, seconds, rpe? }

export function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const offset = (d.getDay() + 6) % 7; // lunes = 0
  d.setDate(d.getDate() - offset);
  return d;
}

// Días consecutivos con entrenamiento, contando hasta hoy (o hasta ayer si hoy aún no has entrenado).
export function computeStreak(history, now = new Date()) {
  const days = new Set(history.map((h) => dayKey(h.date)));
  const cursor = new Date(now);
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function computeStats(history, now = new Date()) {
  const weekStart = startOfWeek(now);
  const thisWeek = history.filter((h) => new Date(h.date) >= weekStart);
  return {
    total: history.length,
    minutes: Math.round(history.reduce((sum, h) => sum + (h.seconds || 0), 0) / 60),
    thisWeek: thisWeek.length,
    streak: computeStreak(history, now),
  };
}

// Sesiones por día de la semana actual (lunes..domingo), para el gráfico semanal.
export function weekActivity(history, now = new Date()) {
  const start = startOfWeek(now);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = dayKey(d);
    return {
      key,
      label: ['L', 'M', 'X', 'J', 'V', 'S', 'D'][i],
      minutes: Math.round(
        history.filter((h) => dayKey(h.date) === key).reduce((sum, h) => sum + (h.seconds || 0), 0) / 60,
      ),
      isToday: key === dayKey(now),
    };
  });
}
