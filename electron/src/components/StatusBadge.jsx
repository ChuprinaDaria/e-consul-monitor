export default function StatusBadge({ status }) {
  const map = {
    authenticating: { label: 'Авторизація...', cls: 'bg-purple-100 text-purple-800' },
    'waiting-auth': { label: 'Скануй QR', cls: 'bg-purple-100 text-purple-800 animate-pulse' },
    monitoring: { label: 'Моніторинг', cls: 'bg-yellow-100 text-yellow-800' },
    found: { label: 'Слот знайдено!', cls: 'bg-green-100 text-green-800 animate-pulse' },
    booking: { label: 'Бронювання...', cls: 'bg-blue-100 text-blue-800' },
    booked: { label: 'Заброньовано', cls: 'bg-green-200 text-green-900' },
    stopped: { label: 'Стоп', cls: 'bg-gray-100 text-gray-600' },
    error: { label: 'Помилка', cls: 'bg-red-100 text-red-800' },
  }
  const { label, cls } = map[status] || map.stopped
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>
}
