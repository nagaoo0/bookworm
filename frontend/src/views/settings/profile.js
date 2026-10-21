// Settings · Profile: avatar, banner, bio, public-profile switch, share link.
import { api } from '../../api.js';
import { html, safeUrl } from '../../utils.js';
import {
  ACTION, TOAST, avatar, button, card, delegate, field, mountFields, setButtonLoading, setFieldError, switchRow, toast,
} from '../../ui/index.js';
import { createScope, errorText, isHttpUrl, patchUser } from './common.js';

const BIO_MAX = 300;
const URL_ERROR = 'Enter a link that starts with http:// or https://';

export function mount(el, { user }) {
  const scope = createScope();
  const profileUrl = `${location.origin}${location.pathname}#u/${encodeURIComponent(user.username)}`;

  el.innerHTML = String(html`
    <form data-profile-form novalidate>
      ${card({ content: html`
        <div class="space-y-5">
          <div class="flex items-center gap-4">
            <span data-avatar-preview>${avatar({ username: user.username, avatarUrl: user.avatarUrl, size: 72 })}</span>
            <div class="min-w-0">
              <p class="h3 truncate">@${user.username}</p>
              <p class="text-small text-text-2">Shown on your profile, in the feed and in comments.</p>
            </div>
          </div>
          ${field({ name: 'avatarUrl', label: 'Avatar URL', type: 'url', value: user.avatarUrl ?? '', placeholder: 'https://example.com/photo.jpg', autocomplete: 'off', inputmode: 'url' })}
          ${field({ name: 'bannerUrl', label: 'Banner URL', type: 'url', value: user.bannerUrl ?? '', placeholder: 'https://example.com/banner.jpg', hint: 'A wide image shown behind your name.', autocomplete: 'off', inputmode: 'url' })}
          <div data-banner-preview class="${isHttpUrl(user.bannerUrl) ? '' : 'hidden'}">
            <img class="w-full h-24 object-cover rounded-md border border-border-1" alt="" data-banner-img src="${isHttpUrl(user.bannerUrl) ? safeUrl(user.bannerUrl) : ''}">
          </div>
          ${field({ name: 'bio', label: 'Bio', type: 'textarea', rows: 3, maxlength: BIO_MAX, value: user.bio ?? '', placeholder: 'A few words about you', hint: 'Shown on your public profile.' })}
          <div>${button({ label: ACTION.saveChanges, variant: 'primary', type: 'submit', attrs: 'data-save' })}</div>
          <p class="field__error" role="alert" data-form-error hidden></p>
        </div>` })}
    </form>

    ${card({ content: html`
      <div class="space-y-4">
        <div data-visibility>${visibilityRow(user.isPublic !== false)}</div>
        <div class="rounded-md bg-surface-2 p-3 space-y-2">
          <p class="label">Profile link</p>
          <p class="text-small break-all"><a class="text-accent-text hover:underline" href="${profileUrl}">${profileUrl}</a></p>
          <p class="text-small text-text-2" data-private-note ${user.isPublic === false ? '' : 'hidden'}>Your profile is private, so only you can open this link.</p>
          ${button({ label: ACTION.copyLink, variant: 'secondary', size: 'sm', icon: 'link', attrs: 'data-action="copy-link"' })}
        </div>
      </div>` })}`);

  scope.add(mountFields(el));

  const form = el.querySelector('[data-profile-form]');
  const avatarInput = form.elements.avatarUrl;
  const bannerInput = form.elements.bannerUrl;
  const bannerWrap = el.querySelector('[data-banner-preview]');
  const bannerImg = el.querySelector('[data-banner-img]');
  const avatarWrap = el.querySelector('[data-avatar-preview]');
  const formError = el.querySelector('[data-form-error]');

  // Live previews (only for links that would be accepted)
  const onInput = (e) => {
    if (e.target === avatarInput) {
      const v = avatarInput.value.trim();
      avatarWrap.innerHTML = String(avatar({ username: user.username, avatarUrl: isHttpUrl(v) ? v : null, size: 72 }));
      if (!v || isHttpUrl(v)) setFieldError(avatarInput, null);
    } else if (e.target === bannerInput) {
      const v = bannerInput.value.trim();
      if (isHttpUrl(v)) { bannerImg.src = safeUrl(v); bannerWrap.classList.remove('hidden'); }
      else { bannerWrap.classList.add('hidden'); }
      if (!v || isHttpUrl(v)) setFieldError(bannerInput, null);
    }
  };
  form.addEventListener('input', onInput);
  scope.add(() => form.removeEventListener('input', onInput));

  const onSubmit = async (e) => {
    e.preventDefault();
    const avatarUrl = avatarInput.value.trim();
    const bannerUrl = bannerInput.value.trim();
    const bio = form.elements.bio.value.trim();
    formError.hidden = true;

    let valid = true;
    if (avatarUrl && !isHttpUrl(avatarUrl)) { setFieldError(avatarInput, URL_ERROR); valid = false; } else setFieldError(avatarInput, null);
    if (bannerUrl && !isHttpUrl(bannerUrl)) { setFieldError(bannerInput, URL_ERROR); valid = false; } else setFieldError(bannerInput, null);
    if (!valid) { (form.querySelector('[aria-invalid="true"]'))?.focus(); return; }

    const btn = form.querySelector('[data-save]');
    setButtonLoading(btn, true);
    try {
      const updated = await api.updateMe({ bio: bio || null, avatarUrl: avatarUrl || null, bannerUrl: bannerUrl || null });
      if (scope.disposed) return;
      patchUser({ bio: updated.bio, avatarUrl: updated.avatarUrl, bannerUrl: updated.bannerUrl });
      toast(TOAST.profileSaved);
    } catch (err) {
      if (scope.disposed) return;
      formError.textContent = errorText(err, "Couldn't save your profile — try again");
      formError.hidden = false;
    } finally {
      setButtonLoading(btn, false);
    }
  };
  form.addEventListener('submit', onSubmit);
  scope.add(() => form.removeEventListener('submit', onSubmit));

  // Public profile: applies immediately; the switch reverts if the request fails
  scope.add(delegate(el, 'change', '[data-visibility] .switch', async (e, sw) => {
    const isPublic = !!e.detail?.checked;
    sw.disabled = true;
    try {
      const updated = await api.updateMe({ isPublic });
      if (scope.disposed) return;
      patchUser({ isPublic: updated?.isPublic ?? isPublic });
      el.querySelector('[data-private-note]').hidden = isPublic;
      toast(TOAST.settingsSaved);
    } catch {
      if (scope.disposed) return;
      sw.setAttribute('aria-checked', String(!isPublic));
      toast("Couldn't update your profile visibility — try again", { type: 'error' });
    } finally {
      sw.disabled = false;
    }
  }));

  scope.add(delegate(el, 'click', '[data-action="copy-link"]', async () => {
    try { await navigator.clipboard.writeText(profileUrl); toast(TOAST.linkCopied); }
    catch { toast("Couldn't copy the link — try again", { type: 'error' }); }
  }));

  return scope.dispose;
}


function visibilityRow(checked) {
  return switchRow({
    id: 'settings-public-profile',
    label: 'Public profile',
    description: 'When off, only you can see your profile, shelves and reading activity',
    checked,
  });
}
