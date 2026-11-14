// Функция подстановки логина/пароля. Выполняется ВНУТРИ страницы через chrome.scripting.executeScript,
// поэтому должна быть полностью самодостаточной (никаких внешних переменных и импортов).
// Возвращает { userDone, passDone }.
export function fillInPage(opts) {
  return new Promise((resolve) => {
    const { username, password, autoSubmit, skipUser, timeoutMs, auto } = opts;
    const state = { userDone: !!skipUser, passDone: false };
    let finished = false;

    const info = (e) => [e.name, e.id, e.placeholder, e.getAttribute('aria-label'), e.autocomplete].join(' ').toLowerCase();
    const visible = (el) => {
      if (!el || el.disabled || el.readOnly) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    // Значение ставим через родной setter прототипа — так работают React / Vue / Angular
    const setVal = (el, v) => {
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      if (setter) setter.call(el, v); else el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    };
    const BAD = /search|поиск|captcha|otp|2fa|verif|code|token|coupon|promo|card|cvv|zip|postal/;
    const LOGINISH = /user|login|email|e-mail|mail|phone|tel|логин|почт|account|nick|name/;
    const userCandidates = () =>
      [...document.querySelectorAll('input:not([type]),input[type=text],input[type=email],input[type=tel]')]
        .filter(visible).filter((e) => !BAD.test(info(e)));
    const userBefore = (pw) => {
      const c = userCandidates();
      const before = c.filter((e) => e.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
      return before.length ? before[before.length - 1] : c[0] || null;
    };
    const userAlone = () => {
      const c = userCandidates();
      return c.find((e) => e.autocomplete === 'username' || e.type === 'email' || LOGINISH.test(info(e))) || null;
    };
    const submit = (el) => {
      setTimeout(() => {
        const form = el.form;
        const btn = (form || document).querySelector('button[type=submit],input[type=submit]') || (form && form.querySelector('button:not([type])'));
        if (btn && visible(btn)) btn.click();
        else if (form && form.requestSubmit) form.requestSubmit();
        else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }, 250);
    };

    let mo, iv, to;
    const finish = () => {
      if (finished) return;
      finished = true;
      try { mo && mo.disconnect(); clearInterval(iv); clearTimeout(to); } catch { /* ignore */ }
      // что видела функция: пригодится для журнала автозаполнения
      let pwCount = 0, pwVisible = 0, userVisible = 0;
      try { const all = [...document.querySelectorAll('input[type=password]')]; pwCount = all.length; pwVisible = all.filter(visible).length; userVisible = userCandidates().length; } catch { /* ignore */ }
      resolve({ ...state, pwCount, pwVisible, userVisible, frameUrl: location.href.slice(0, 120) });
    };
    const attempt = () => {
      if (finished) return;
      try {
        // при автозаполнении пропускаем поля «новый пароль» (регистрация, смена пароля)
        const pw = [...document.querySelectorAll('input[type=password]')].find((e) => visible(e) && !(auto && /new-password/.test(e.autocomplete || '')));
        if (pw) {
          if (!state.userDone && username) {
            const u = userBefore(pw);
            if (u && u !== pw) setVal(u, username);
            state.userDone = true;
          }
          setVal(pw, password);
          state.passDone = true;
          if (autoSubmit) submit(pw);
          finish();
          return;
        }
        if (!state.userDone && username) {
          const u = userAlone();
          if (u) {
            setVal(u, username);
            state.userDone = true;
            if (autoSubmit) submit(u);
          }
        }
      } catch { /* страница меняется — повторим */ }
    };

    attempt();
    if (finished) return;
    mo = new MutationObserver(attempt);
    mo.observe(document.documentElement, { childList: true, subtree: true });
    iv = setInterval(attempt, 500);
    to = setTimeout(finish, timeoutMs || 15000);
  });
}
