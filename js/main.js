import { initVisualizer } from './visualizer.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// Where estimate requests are delivered (FormSubmit relays to this inbox).
const ESTIMATE_EMAIL = 'highsierraluxuryepoxycoatings@gmail.com';

/* nav */
const nav = $('.nav'), toggle = $('#navToggle'), links = $('#navLinks');
const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 20);
onScroll(); window.addEventListener('scroll', onScroll, { passive: true });
toggle.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open)); links.classList.toggle('open', open);
});
links.addEventListener('click', (e) => { if (e.target.closest('a')) { toggle.setAttribute('aria-expanded', 'false'); links.classList.remove('open'); } });

/* reveal on scroll */
const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
$$('.reveal').forEach((el) => io.observe(el));

/* lazy videos: load + play only while visible */
const vio = new IntersectionObserver((es) => es.forEach((e) => {
  const v = e.target;
  if (e.isIntersecting) {
    if (v.dataset.src && !v.src) { v.src = v.dataset.src; v.load(); }
    v.play().catch(() => {});
  } else v.pause();
}), { threshold: 0.35 });
$$('video[data-src]').forEach((v) => vio.observe(v));

/* visualizer -> estimate form */
const designCard = $('#designCard');
document.addEventListener('design:estimate', ({ detail }) => {
  $('#designSummary').textContent = detail.summary;
  $('#designField').value = detail.summary;
  $('#designLink').value = detail.link;
  if (detail.thumb) $('#designThumb').src = detail.thumb; else $('#designThumb').removeAttribute('src');
  const sel = $('#systemSelect'); [...sel.options].forEach((o) => { if (o.text === detail.system) sel.value = o.value; });
  designCard.hidden = false;
  (window.innerWidth < 981 ? form : $('#estimate')).scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => $('#estimateForm [name=name]').focus({ preventScroll: true }), 700);
});
$('#designClear').addEventListener('click', () => { designCard.hidden = true; $('#designField').value = ''; $('#designLink').value = ''; });

/* estimate form */
const form = $('#estimateForm'), status = $('#formStatus'), btn = $('#submitBtn');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (form._honey.value) return;
  let ok = true;
  for (const f of [form.name, form.phone]) { const bad = !f.value.trim(); f.classList.toggle('invalid', bad); ok = ok && !bad; }
  if (form.email.value && !/^\S+@\S+\.\S+$/.test(form.email.value)) { form.email.classList.add('invalid'); ok = false; } else form.email.classList.remove('invalid');
  if (!ok) { status.className = 'form-status err'; status.textContent = 'Please add your name and phone number.'; return; }

  const data = Object.fromEntries(new FormData(form));
  delete data._honey;
  const payload = {
    _subject: `New free estimate request: ${data.name}${data.city ? ' (' + data.city + ')' : ''}`,
    _template: 'table', _captcha: 'false',
    Name: data.name, Phone: data.phone, Email: data.email || '-', City: data.city || '-',
    'Project type': data.project, Size: data.size, System: data.system, 'Contact preference': data.contact_pref,
    'Floor design (3D designer)': data.design || 'None selected', 'Design link': data.design_link || '-', Message: data.message || '-',
  };
  if (data.email) payload._replyto = data.email;

  btn.disabled = true; btn.textContent = 'Sending…'; status.className = 'form-status'; status.textContent = '';
  try {
    const r = await fetch(`https://formsubmit.co/ajax/${ESTIMATE_EMAIL}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || String(j.success) === 'false') throw new Error(j.message || 'send failed');
    form.reset(); designCard.hidden = true;
    status.className = 'form-status ok';
    status.textContent = "Thank you! We got your request and will reach out within one business day.";
  } catch (err) {
    const body = Object.entries(payload).filter(([k]) => !k.startsWith('_')).map(([k, v]) => `${k}: ${v}`).join('\n');
    status.className = 'form-status err';
    status.innerHTML = `We couldn't send that automatically. <a href="mailto:${ESTIMATE_EMAIL}?subject=${encodeURIComponent('Free estimate request')}&body=${encodeURIComponent(body)}">Email it instead</a> or call <a href="tel:+17753781381">775-378-1381</a>.`;
  } finally {
    btn.disabled = false; btn.textContent = 'Request My Free Estimate';
  }
});

$('#year').textContent = new Date().getFullYear();

initVisualizer();
