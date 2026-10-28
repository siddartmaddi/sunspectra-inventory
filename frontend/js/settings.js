// settings.js: alert email and forecast settings, plus the supplier list.
import { getBootstrap, write } from './api.js';
import { t } from './i18n.js';
import { esc, toast, withLoading, errorBox, openDialog, closeDialog } from './utils.js';

// [setting key, label key, input type, hint key]
const FIELDS = [
  ['company_name', 'set.companyName', 'text'],
  ['alert_email', 'set.alertEmail', 'text', 'set.alertEmailHint'],
  ['alert_hour', 'set.alertHour', 'number'],
  ['app_url', 'set.appUrl', 'url'],
  ['service_level', 'set.serviceLevel', 'select', 'set.serviceLevelHint'],
  ['forecast_window_days', 'set.forecastWindow', 'number'],
  ['stockout_warning_days', 'set.warningDays', 'number'],
  ['spike_multiplier', 'set.spike', 'number', 'set.spikeHint']
];
const SERVICE_LEVELS = [['0.9', '90%'], ['0.95', '95%'], ['0.98', '98%']];

export async function render(container) {
  const boot = await getBootstrap();
  const s = boot.settings;

  const input = ([key, , type]) => {
    if (type === 'select') {
      return `<select id="s-${key}" name="${key}">${SERVICE_LEVELS.map(([v, l]) =>
        `<option value="${v}"${Number(s[key]) === Number(v) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    }
    return `<input id="s-${key}" name="${key}" type="${type}" ${type === 'number' ? 'step="any" inputmode="decimal"' : ''} value="${esc(s[key] ?? '')}">`;
  };

  container.innerHTML = `
    <div class="page-head"><h1>${esc(t('set.title'))}</h1></div>
    <form class="card" id="settings-form" novalidate>
      <h2 style="margin-top:0">${esc(t('set.general'))}</h2>
      <div class="form-grid">
        ${FIELDS.map((f) => `<div class="field"><label for="s-${f[0]}">${esc(t(f[1]))}</label>${input(f)}
          ${f[3] ? `<div class="hint">${esc(t(f[3]))}</div>` : ''}</div>`).join('')}
      </div>
      <label class="check"><input type="checkbox" name="include_samples_in_demand" ${String(s.include_samples_in_demand).toUpperCase() === 'TRUE' ? 'checked' : ''}>
        ${esc(t('set.includeSamples'))}</label>
      <div id="settings-error"></div>
      <p><button type="submit" id="save-settings">${esc(t('common.save'))}</button></p>
    </form>

    <div class="card">
      <div class="page-head" style="margin:0">
        <h2 style="margin:0">${esc(t('set.suppliers'))}</h2>
        <button type="button" class="secondary" id="add-supplier">${esc(t('set.addSupplier'))}</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>${esc(t('set.supplierName'))}</th><th>${esc(t('set.contact'))}</th><th>${esc(t('set.email'))}</th>
          <th>${esc(t('set.phone'))}</th><th>${esc(t('set.notes'))}</th><th></th></tr></thead>
        <tbody>${boot.suppliers.map((sup) => `<tr>
          <td>${esc(sup.name)}</td><td>${esc(sup.contact)}</td><td>${esc(sup.email)}</td><td>${esc(sup.phone)}</td>
          <td class="small">${esc(sup.notes)}</td>
          <td class="actions"><button type="button" class="secondary small" data-edit="${esc(sup.supplier_id)}">${esc(t('common.edit'))}</button></td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`;

  const form = container.querySelector('#settings-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const settings = Object.fromEntries(FIELDS.map(([key]) => [key, form.elements[key].value.trim()]));
    settings.include_samples_in_demand = form.elements.include_samples_in_demand.checked ? 'TRUE' : 'FALSE';
    withLoading(container.querySelector('#save-settings'), async () => {
      try {
        await write('updateSettings', { settings });
        container.querySelector('#settings-error').innerHTML = '';
        toast(t('common.saved'));
      } catch (err) {
        container.querySelector('#settings-error').innerHTML = errorBox(err);
      }
    });
  });

  const reload = () => render(container);
  container.querySelector('#add-supplier').addEventListener('click', () => openSupplierForm(null, reload));
  container.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () =>
    openSupplierForm(boot.suppliers.find((x) => x.supplier_id === b.dataset.edit), reload)));
}

function openSupplierForm(supplier, onSaved) {
  const s = supplier || {};
  const fields = [['name', 'set.supplierName'], ['contact', 'set.contact'], ['email', 'set.email'], ['phone', 'set.phone'], ['notes', 'set.notes']];
  const dlg = openDialog(supplier ? t('set.editSupplier') : t('set.newSupplier'),
    `<form id="supplier-form" novalidate>${fields.map(([k, label]) => `<div class="field"><label for="sup-${k}">${esc(t(label))}</label>
      <input id="sup-${k}" name="${k}" type="${k === 'email' ? 'email' : 'text'}" value="${esc(s[k] || '')}"></div>`).join('')}
      <div id="supplier-error"></div></form>`,
    `<button type="button" class="secondary" data-close>${esc(t('common.cancel'))}</button>
     <button type="submit" form="supplier-form" id="save-supplier">${esc(t('common.save'))}</button>`);
  const form = dlg.querySelector('#supplier-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    if (supplier) data.supplier_id = supplier.supplier_id;
    withLoading(dlg.querySelector('#save-supplier'), async () => {
      try {
        await write('upsertSupplier', { supplier: data });
        closeDialog();
        toast(t('common.saved'));
        onSaved();
      } catch (err) {
        dlg.querySelector('#supplier-error').innerHTML = errorBox(err);
      }
    });
  });
}
