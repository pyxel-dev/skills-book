'use strict';
/* AI chat panel: one in-memory conversation per file, proposals reviewed as a diff. */
window.AiPanel = (() => {
  const PROVIDERS = ['anthropic', 'openai', 'local'];

  function init({ api, Proposal, t, toast, errMsg, getText, applyText, onLayout, openSettings }) {
    const $ = (id) => document.getElementById(id);
    const panel = $('ai-panel');
    const log = $('ai-log');
    const input = $('ai-text');
    const sendBtn = $('ai-send');
    const providerSelect = $('ai-provider');
    const modelInput = $('ai-model');
    const conversations = new Map(); // document id -> { messages, pending }
    let doc = null;
    let isOpen = false;
    let settings = null;
    let nextRequest = 0;

    function conversation() {
      if (!conversations.has(doc.id)) conversations.set(doc.id, { messages: [], pending: null });
      return conversations.get(doc.id);
    }

    // Always textContent: replies may carry prompt injection from the file, and the CSP allows
    // https images, so rendered Markdown could send file content to an external server.
    function el(tag, className, text) {
      const node = document.createElement(tag);
      node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function button(className, text, onClick) {
      const node = el('button', className, text);
      node.type = 'button';
      node.addEventListener('click', onClick);
      return node;
    }

    const needsKey = () => settings && settings.provider !== 'local' && !settings.hasKey[settings.provider];

    function renderProposal(msg, proposal) {
      const next = Proposal.matchEnding(proposal, msg.base);
      const ops = Proposal.diffLines(msg.base, next);
      if (!ops.some((op) => op.type !== 'equal')) return el('div', 'ai-note', t('ai.noChanges'));

      const diff = el('div', 'ai-diff');
      for (const op of Proposal.compact(ops)) diff.append(el('div', `ai-line ai-${op.type}`, op.text || ' '));

      const foot = el('div', 'ai-card-foot');
      if (msg.outcome) {
        foot.append(el('span', 'ai-note', t(`ai.${msg.outcome}`)));
      } else {
        foot.append(
          button('btn primary', t('ai.apply'), () => {
            if (getText() !== msg.base) { toast(t('ai.stale'), 'error'); return; }
            applyText(next);
            msg.outcome = 'applied';
            render();
          }),
          button('btn ghost', t('ai.ignore'), () => {
            msg.outcome = 'ignored';
            render();
          }),
        );
      }

      const card = el('div', 'ai-card');
      if (!msg.outcome && Proposal.removesMost(ops)) card.append(el('div', 'ai-warning', t('ai.shrinks')));
      card.append(diff, foot);
      return card;
    }

    function renderMessage(msg) {
      if (msg.role !== 'assistant') return [el('div', `ai-msg ai-${msg.role}`, msg.content)];
      const { status, before, proposal, after } = Proposal.extract(msg.content);
      const parts = [];
      if (before) parts.push(el('div', 'ai-msg ai-assistant', before));
      if (status === 'complete') parts.push(renderProposal(msg, proposal));
      if (status === 'unclosed') parts.push(el('div', 'ai-note', t('ai.truncated')));
      if (after) parts.push(el('div', 'ai-msg ai-assistant', after));
      return parts;
    }

    function render() {
      const wasHidden = panel.hidden;
      panel.hidden = !(isOpen && doc);
      document.querySelector('.app').classList.toggle('ai-open', !panel.hidden);
      if (wasHidden !== panel.hidden) onLayout();
      if (panel.hidden) return;

      const conv = conversation();
      log.replaceChildren();
      if (needsKey()) {
        const setup = el('div', 'ai-setup', t('ai.setup'));
        setup.append(button('btn', t('ai.openSettings'), openSettings));
        log.append(setup);
      }
      for (const msg of conv.messages) log.append(...renderMessage(msg));
      if (conv.pending) log.append(el('div', 'ai-note', t('ai.thinking')));
      sendBtn.textContent = t(conv.pending ? 'ai.stop' : 'ai.send');
      log.scrollTop = log.scrollHeight;
    }

    async function loadModels() {
      const models = needsKey() ? [] : await api.aiModels().catch(() => []);
      $('ai-models').replaceChildren(...models.map((id) => {
        const option = document.createElement('option');
        option.value = id;
        return option;
      }));
    }

    async function refresh(next) {
      settings = next || await api.aiGetSettings();
      providerSelect.value = settings.provider;
      modelInput.value = settings.models[settings.provider];
      render();
      // No AI network call while the panel is closed.
      if (isOpen) loadModels();
    }

    async function send() {
      const content = input.value.trim();
      if (!content) return;
      const conv = conversation();
      const base = getText();
      const requestId = String(++nextRequest);
      const turn = { role: 'user', content };
      conv.messages.push(turn);
      conv.pending = requestId;
      input.value = '';
      render();
      const history = conv.messages
        .filter((msg) => msg.role !== 'error' && !msg.unanswered)
        .map((msg) => ({ role: msg.role, content: msg.content }));
      let reply = null;
      try {
        reply = await api.aiSend(requestId, base, history);
        if (reply !== null) conv.messages.push({ role: 'assistant', content: reply, base, outcome: null });
      } catch (e) {
        conv.messages.push({ role: 'error', content: errMsg(e) });
      }
      if (reply === null) {
        // Never resent: strict local chat templates reject two user turns in a row, and a stopped request stays stopped.
        turn.unanswered = true;
        // The input is shared by all files: only restore into the conversation the text belongs to.
        if (!input.value && conversations.get(doc?.id) === conv) input.value = content;
      }
      conv.pending = null;
      render();
    }

    function applyLang() {
      providerSelect.replaceChildren(...PROVIDERS.map((id) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = t(`ai.provider.${id}`);
        return option;
      }));
      if (settings) providerSelect.value = settings.provider;
      sendBtn.textContent = t('ai.send');
      render();
    }

    function setOpen(next) {
      isOpen = next;
      if (isOpen) refresh();
      else render();
    }

    $('btn-ai').addEventListener('click', () => setOpen(!isOpen));
    $('ai-close').addEventListener('click', () => setOpen(false));
    $('ai-clear').addEventListener('click', () => {
      const conv = conversation();
      if (conv.pending) api.aiCancel(conv.pending);
      conversations.delete(doc.id);
      render();
    });
    providerSelect.addEventListener('change', async () => refresh(await api.aiSetSettings({ provider: providerSelect.value })));
    modelInput.addEventListener('change', async () => {
      try {
        settings = await api.aiSetSettings({ model: modelInput.value });
      } catch (e) {
        toast(errMsg(e), 'error');
      }
    });
    $('ai-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const conv = conversation();
      if (conv.pending) api.aiCancel(conv.pending);
      else send();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      if (!conversation().pending) send();
    });

    return {
      setDocument(next) {
        doc = next;
        render();
      },
      refresh,
      applyLang,
    };
  }

  return { init };
})();
