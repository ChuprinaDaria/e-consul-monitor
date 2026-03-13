import React, { useState } from 'react'
import { COUNTRIES, SERVICES, COUNTRY_NAMES } from '../utils/consulatesData.js'

export default function UserFormScreen({ config, onSave }) {
  const [form, setForm] = useState({
    surname: config.user.surname || '',
    name: config.user.name || '',
    patronymic: config.user.patronymic || '',
    birthdate: config.user.birthdate || '',
    gender: config.user.gender || '',
    country: config.consulate.country || '',
    institution: config.consulate.institution || '',
    institutionCode: config.consulate.institutionCode || '',
    service: config.consulate.service || '',
    serviceCode: config.consulate.serviceCode || '',
    monitorAll: config.consulate.monitorAll || false,
    minDate: config.monitoring.minDate || '',
    bookingTimeFrom: config.monitoring.bookingTimeFrom || '',
    bookingTimeTo: config.monitoring.bookingTimeTo || '',
  })
  const [bookingTarget, setBookingTarget] = useState(config.bookingFor?.target || 'self')
  const [persons, setPersons] = useState(config.bookingFor?.persons || [])
  const [saved, setSaved] = useState(false)

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    setSaved(false)
  }

  function addPerson() {
    setPersons(p => [...p, { surname: '', name: '', patronymic: '', noPatronymic: false }])
    setSaved(false)
  }

  function removePerson(i) {
    setPersons(p => p.filter((_, idx) => idx !== i))
    setSaved(false)
  }

  function updatePerson(i, field, value) {
    setPersons(p => p.map((person, idx) => idx === i ? { ...person, [field]: value } : person))
    setSaved(false)
  }

  const consulates = COUNTRIES[form.country] || []
  const allCodesInCountry = consulates.map(c => c.code).filter(Boolean)

  async function handleSave() {
    await onSave({
      ...config,
      user: {
        surname: form.surname,
        name: form.name,
        patronymic: form.patronymic,
        birthdate: form.birthdate,
        gender: form.gender,
      },
      consulate: {
        country: form.country,
        institution: form.monitorAll ? 'Всі' : form.institution,
        institutionCode: form.monitorAll ? '' : form.institutionCode,
        institutionCodes: form.monitorAll ? allCodesInCountry : (form.institutionCode ? [form.institutionCode] : []),
        service: form.service,
        serviceCode: form.serviceCode,
        monitorAll: form.monitorAll,
      },
      monitoring: {
        ...config.monitoring,
        minDate: form.minDate,
        bookingTimeFrom: form.bookingTimeFrom,
        bookingTimeTo: form.bookingTimeTo,
      },
      bookingFor: {
        target: bookingTarget,
        persons: bookingTarget === 'other' ? persons : [],
      },
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const inputCls = 'w-full border rounded px-3 py-2 text-sm'
  const labelCls = 'block text-sm font-medium mb-1'

  return (
    <div className="p-6 max-w-xl space-y-4">
      <h2 className="text-lg font-bold">Дані користувача</h2>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className={labelCls}>Прізвище</label>
          <input className={inputCls} value={form.surname} onChange={e => set('surname', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Ім'я</label>
          <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>По батькові</label>
          <input className={inputCls} value={form.patronymic} onChange={e => set('patronymic', e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Дата народження</label>
          <input className={inputCls} type="date" value={form.birthdate} onChange={e => set('birthdate', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Стать</label>
          <select className={inputCls} value={form.gender} onChange={e => set('gender', e.target.value)}>
            <option value="">—</option>
            <option>Чоловіча</option>
            <option>Жіноча</option>
          </select>
        </div>
      </div>

      <section>
        <h3 className="font-semibold mb-2">Для кого бронюємо</h3>
        <div className="flex gap-4">
          <label className="flex items-center gap-1 text-sm">
            <input type="radio" name="bookingTarget" value="self"
              checked={bookingTarget === 'self'} onChange={() => { setBookingTarget('self'); setSaved(false) }} />
            Для себе
          </label>
          <label className="flex items-center gap-1 text-sm">
            <input type="radio" name="bookingTarget" value="other"
              checked={bookingTarget === 'other'} onChange={() => { setBookingTarget('other'); setSaved(false) }} />
            Для дитини / підопічного
          </label>
        </div>

        {bookingTarget === 'other' && (
          <div className="mt-3 space-y-3">
            {persons.map((p, i) => (
              <div key={i} className="border rounded p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">Особа {i + 1}</span>
                  <button onClick={() => removePerson(i)} className="text-red-500 text-sm hover:text-red-700">Видалити</button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-gray-500">Прізвище</label>
                    <input className={inputCls} value={p.surname} onChange={e => updatePerson(i, 'surname', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Ім'я</label>
                    <input className={inputCls} value={p.name} onChange={e => updatePerson(i, 'name', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">По батькові</label>
                    <div className="flex items-center gap-1">
                      <input className={inputCls} value={p.patronymic} disabled={p.noPatronymic}
                        onChange={e => updatePerson(i, 'patronymic', e.target.value)} />
                    </div>
                    <label className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                      <input type="checkbox" checked={p.noPatronymic || false}
                        onChange={e => updatePerson(i, 'noPatronymic', e.target.checked)} />
                      Немає
                    </label>
                  </div>
                </div>
              </div>
            ))}
            <button onClick={addPerson}
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-sm">
              + Додати особу
            </button>
          </div>
        )}
      </section>

      <div>
        <label className={labelCls}>Країна</label>
        <select className={inputCls} value={form.country}
          onChange={e => {
            setForm(f => ({ ...f, country: e.target.value, institution: '', institutionCode: '', monitorAll: false }))
            setSaved(false)
          }}>
          <option value="">—</option>
          {COUNTRY_NAMES.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>

      <div>
        <label className={labelCls}>Консульство</label>
        <select className={inputCls}
          value={form.monitorAll ? '__all__' : form.institution}
          onChange={e => {
            if (e.target.value === '__all__') {
              setForm(f => ({ ...f, monitorAll: true, institution: '', institutionCode: '' }))
            } else {
              const selected = consulates.find(c => c.name === e.target.value)
              setForm(f => ({
                ...f,
                monitorAll: false,
                institution: e.target.value,
                institutionCode: selected?.code || '',
              }))
            }
            setSaved(false)
          }}>
          <option value="">—</option>
          {consulates.length > 1 && (
            <option value="__all__">Всі консульства в {form.country} ({allCodesInCountry.length})</option>
          )}
          {consulates.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        {form.monitorAll && (
          <p className="text-xs text-gray-500 mt-1">
            Моніторинг {allCodesInCountry.length} консульств паралельно
          </p>
        )}
      </div>

      <div>
        <label className={labelCls}>Послуга</label>
        <select className={inputCls} value={form.service}
          onChange={e => {
            const selected = SERVICES.find(s => s.name === e.target.value)
            setForm(f => ({
              ...f,
              service: e.target.value,
              serviceCode: selected?.code || '',
            }))
            setSaved(false)
          }}>
          <option value="">—</option>
          {SERVICES.map(s => <option key={s.code} value={s.name}>{s.name}</option>)}
        </select>
      </div>

      <div>
        <label className={labelCls}>Мінімальна дата</label>
        <input className={inputCls} type="date" value={form.minDate} onChange={e => set('minDate', e.target.value)} />
      </div>

      <div>
        <label className={labelCls}>Бажаний інтервал часу (для бронювання)</label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-500">Від</label>
            <input className={inputCls} type="time" value={form.bookingTimeFrom}
              onChange={e => set('bookingTimeFrom', e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-500">До</label>
            <input className={inputCls} type="time" value={form.bookingTimeTo}
              onChange={e => set('bookingTimeTo', e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          В режимі "Бронювати" — бронюватиме тільки слоти в цьому інтервалі
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={handleSave}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium">
          Зберегти
        </button>
        {saved && <span className="text-green-600 text-sm">Збережено!</span>}
      </div>
    </div>
  )
}
