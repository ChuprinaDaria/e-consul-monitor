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
  })
  const [saved, setSaved] = useState(false)

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
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
