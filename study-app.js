const STORAGE_KEY = 'oge-atlas-compact-v2';

if (!Object.fromEntries) {
  Object.fromEntries = function fromEntries(entries) {
    const result = {};
    (entries || []).forEach((entry) => {
      if (!entry || entry.length < 2) {
        return;
      }
      result[entry[0]] = entry[1];
    });
    return result;
  };
}

if (!Array.prototype.flat) {
  Array.prototype.flat = function flat(depth) {
    const level = depth == null ? 1 : Number(depth) || 0;
    if (level < 1) {
      return this.slice();
    }

    return this.reduce((result, item) => {
      if (Array.isArray(item)) {
        return result.concat(item.flat(level - 1));
      }
      result.push(item);
      return result;
    }, []);
  };
}

if (!Array.prototype.flatMap) {
  Array.prototype.flatMap = function flatMap(callback, thisArg) {
    return this.map(callback, thisArg).flat();
  };
}

const storage = createSafeStorage();

const subjects = window.OGE_DATA.subjects.map((subject) => ({
  ...subject,
  topics: subject.topics.map((topic) => ({
    ...topic,
    subjectId: subject.id,
    subjectTitle: subject.title,
    color: subject.color,
    softColor: subject.softColor
  }))
}));

const subjectMap = new Map(subjects.map((subject) => [subject.id, subject]));
const allTopics = subjects.flatMap((subject) => subject.topics);
const topicMap = new Map(allTopics.map((topic) => [topic.id, topic]));

const detailEl = document.getElementById('detail');
const topicDrawerEl = document.getElementById('topicDrawer');
const drawerBackdropEl = document.getElementById('drawerBackdrop');
const drawerSubjectEl = document.getElementById('drawerSubject');
const topicMetaEl = document.getElementById('topicMeta');
const topicListEl = document.getElementById('topicList');
const searchInput = document.getElementById('searchInput');
const subjectNavEl = document.getElementById('subjectNav');
const openDrawerButton = document.getElementById('openDrawerButton');
const closeDrawerButton = document.getElementById('closeDrawerButton');
const quizLauncherButton = document.getElementById('quizLauncherButton');
const quizOverlayEl = document.getElementById('quizOverlay');
const quizOverlayContentEl = document.getElementById('quizOverlayContent');
const toastEl = document.getElementById('toast');

const state = loadState();
let toastTimer = null;
let dragState = null;
let quizSession = null;

ensureSelection();
syncAccent();
renderAll();
bindEvents();
registerServiceWorker();

function createSafeStorage() {
  try {
    const testKey = '__oge_atlas_storage_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  } catch (error) {
    const memory = {};
    return {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
      },
      setItem(key, value) {
        memory[key] = String(value);
      },
      removeItem(key) {
        delete memory[key];
      }
    };
  }
}

function loadState() {
  const fallbackSubject = subjects[0];
  const fallbackTopic = fallbackSubject.topics[0];
  const defaultSubjectCounts = Object.fromEntries(
    subjects.map((subject) => [subject.id, subject.id === fallbackSubject.id ? 10 : 0])
  );

  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
    return {
      activeSubject: parsed.activeSubject || fallbackSubject.id,
      activeTopic: parsed.activeTopic || fallbackTopic.id,
      query: parsed.query || '',
      drawerOpen: typeof parsed.drawerOpen === 'boolean' ? parsed.drawerOpen : false,
      quiz: parsed.quiz || {},
      quizMode: parsed.quizMode || {},
      viewMode: parsed.viewMode || 'topic',
      swipeIndex: parsed.swipeIndex || {},
      quizOverlay: Boolean(parsed.quizOverlay),
      quizSetupMode: parsed.quizSetupMode || 'topic',
      quizQuestionStyle: parsed.quizQuestionStyle || 'mixed',
      quizTopicCount: Math.max(10, Number(parsed.quizTopicCount) || 12),
      quizSubjectCounts: { ...defaultSubjectCounts, ...(parsed.quizSubjectCounts || {}) }
    };
  } catch (error) {
    return {
      activeSubject: fallbackSubject.id,
      activeTopic: fallbackTopic.id,
      query: '',
      drawerOpen: false,
      quiz: {},
      quizMode: {},
      viewMode: 'topic',
      swipeIndex: {},
      quizOverlay: false,
      quizSetupMode: 'topic',
      quizQuestionStyle: 'mixed',
      quizTopicCount: 12,
      quizSubjectCounts: defaultSubjectCounts
    };
  }
}

function saveState() {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    return;
  }
}

function getSubject(subjectId) {
  return subjectMap.get(subjectId) || subjects[0];
}

function getTopic(topicId) {
  return topicMap.get(topicId) || allTopics[0];
}

function getSearchText(topic) {
  const theoryText = (topic.theory || [])
    .flatMap((section) => [section.title, ...(section.points || [])])
    .join(' ');
  const taskText = (topic.tasks || [])
    .flatMap((task) => [task.title, task.prompt, task.answer, ...(task.steps || [])])
    .join(' ');
  const exampleText = (topic.examples || [])
    .flatMap((example) => [example.title, ...(example.items || [])])
    .join(' ');
  const tableText = getTables(topic)
    .flatMap((table) => [table.title, ...(table.headers || []), ...(table.rows || []).flat()])
    .join(' ');

  return [
    topic.title,
    topic.summary,
    topic.examFocus,
    ...(topic.tags || []),
    ...(topic.formulas || []),
    ...(topic.hacks || []),
    ...(topic.pitfalls || []),
    ...(topic.checklist || []),
    theoryText,
    taskText,
    exampleText,
    tableText
  ]
    .join(' ')
    .toLowerCase();
}

function getVisibleTopics(subject) {
  const query = state.query.trim().toLowerCase();
  return subject.topics.filter((topic) => !query || getSearchText(topic).includes(query));
}

function ensureSelection() {
  const subject = getSubject(state.activeSubject);
  const visibleTopics = getVisibleTopics(subject);
  const currentTopic = getTopic(state.activeTopic);

  if (!currentTopic || currentTopic.subjectId !== subject.id || !topicMap.has(state.activeTopic)) {
    state.activeTopic = (visibleTopics[0] || subject.topics[0]).id;
    return;
  }

  if (visibleTopics.length && !visibleTopics.some((topic) => topic.id === state.activeTopic)) {
    state.activeTopic = visibleTopics[0].id;
  }
}

function syncAccent() {
  const subject = getSubject(state.activeSubject);
  document.documentElement.style.setProperty('--accent', subject.color);
  document.documentElement.style.setProperty('--accent-soft', subject.softColor);
}

function renderAll() {
  ensureSelection();
  syncAccent();
  searchInput.value = state.query;
  renderSubjectNav();
  renderDrawer();
  renderDetail();
  renderQuizOverlay();
  saveState();
}

function renderSubjectNav() {
  subjectNavEl.innerHTML = subjects
    .map(
      (subject) => `
        <button
          class="subject-nav-button ${subject.id === state.activeSubject ? 'is-active' : ''}"
          type="button"
          data-subject-select="${subject.id}"
          style="--subject-color:${subject.color}; --subject-soft:${subject.softColor};"
        >
          ${escapeHtml(subject.shortTitle)}
        </button>
      `
    )
    .join('');
}

function renderDrawer() {
  const subject = getSubject(state.activeSubject);
  const visibleTopics = getVisibleTopics(subject);

  drawerSubjectEl.textContent = subject.title;
  topicMetaEl.textContent = state.query
    ? `Найдено: ${visibleTopics.length}`
    : `${subject.topics.length} тем`;

  topicListEl.innerHTML = visibleTopics.length
    ? visibleTopics
        .map(
          (topic) => `
            <button
              class="topic-card ${topic.id === state.activeTopic ? 'is-active' : ''}"
              type="button"
              data-topic-select="${topic.id}"
            >
              <span class="tiny-chip">${topic.minutes} мин</span>
              <h3>${escapeHtml(topic.title)}</h3>
            </button>
          `
        )
        .join('')
    : `
        <div class="empty-card">
          <p>Ничего не нашлось. Попробуй другое слово.</p>
        </div>
      `;

  topicDrawerEl.classList.toggle('is-open', state.drawerOpen);
  drawerBackdropEl.classList.toggle('is-visible', state.drawerOpen);
  openDrawerButton.classList.toggle('is-hidden', state.drawerOpen);
}

function renderDetail() {
  const topic = getTopic(state.activeTopic);
  const subject = getSubject(topic.subjectId);

  if (state.viewMode === 'subject') {
    detailEl.innerHTML = renderSubjectScreen(subject);
    return;
  }

  detailEl.innerHTML = `
    <div class="reader-stack">
      <div class="reader-top">
        <button class="ghost-button" type="button" data-open-drawer="true">Темы</button>
        <div class="reader-chips">
          ${renderViewModeBar()}
          <span class="subject-chip" style="background:${subject.softColor}; color:${subject.color}; border-color:${subject.softColor};">
            ${escapeHtml(subject.title)}
          </span>
          <span class="tiny-chip">${topic.minutes} мин</span>
        </div>
      </div>

      <section class="hero-card">
        <h1 class="topic-title">${escapeHtml(topic.title)}</h1>
        <p class="topic-summary">${escapeHtml(topic.summary)}</p>
      </section>

      ${renderFormulaGrid(topic)}
      ${renderTheory(topic)}
      ${renderExamples(topic)}
      ${renderTables(topic)}
      ${renderDiagrams(topic, subject)}
      ${renderTasks(topic)}
      ${renderSupport(topic)}
    </div>
  `;
}

function renderViewModeBar() {
  return `
    <div class="view-mode-bar">
      <button class="view-mode-button ${state.viewMode === 'topic' ? 'is-active' : ''}" type="button" data-view-mode="topic">
        Тема
      </button>
      <button class="view-mode-button ${state.viewMode === 'subject' ? 'is-active' : ''}" type="button" data-view-mode="subject">
        Экран предмета
      </button>
    </div>
  `;
}

function renderSubjectScreen(subject) {
  const quickTopics = subject.topics.slice(0, 6);
  const formulaCards = subject.topics
    .flatMap((topic) =>
      (topic.formulas || []).slice(0, 2).map((formula) => ({
        topicId: topic.id,
        topicTitle: topic.title,
        text: formula
      }))
    )
    .slice(0, 12);
  const exampleCards = subject.topics
    .flatMap((topic) =>
      (topic.examples || []).slice(0, 1).map((example) => ({
        topicId: topic.id,
        title: example.title || topic.title,
        items: (example.items || []).slice(0, 2)
      }))
    )
    .slice(0, 4);
  const supportItems = [
    ...(subject.startHere || []),
    ...(subject.memoryWall || []),
    ...(subject.examHabits || [])
  ].slice(0, 9);

  return `
    <div class="reader-stack">
      <div class="reader-top">
        <button class="ghost-button" type="button" data-open-drawer="true">Темы</button>
        <div class="reader-chips">
          ${renderViewModeBar()}
          <span class="subject-chip" style="background:${subject.softColor}; color:${subject.color}; border-color:${subject.softColor};">
            ${escapeHtml(subject.title)}
          </span>
        </div>
      </div>

      <section class="hero-card hero-card--subject">
        <p class="eyebrow">Экран предмета</p>
        <h1 class="topic-title">${escapeHtml(subject.title)}</h1>
        <p class="topic-summary">${escapeHtml(subject.tagline || '')}</p>
      </section>

      <section class="reader-section">
        <h2 class="section-title">Самое важное</h2>
        <div class="subject-screen-grid">
          ${supportItems
            .map(
              (item) => `
                <article class="subject-screen-card">
                  <p>${formatInline(item)}</p>
                </article>
              `
            )
            .join('')}
        </div>
      </section>

      <section class="reader-section">
        <h2 class="section-title">Карточки по предмету</h2>
        <div class="subject-screen-grid">
          ${formulaCards
            .map(
              (card) => `
                <button class="subject-screen-card subject-screen-card--formula" type="button" data-topic-select="${card.topicId}">
                  <span class="tiny-chip">${escapeHtml(card.topicTitle)}</span>
                  <p>${formatInline(card.text)}</p>
                </button>
              `
            )
            .join('')}
        </div>
      </section>

      ${
        exampleCards.length
          ? `
            <section class="reader-section">
              <h2 class="section-title">Понять на примерах</h2>
              <div class="subject-screen-grid">
                ${exampleCards
                  .map(
                    (card) => `
                      <button class="subject-screen-card" type="button" data-topic-select="${card.topicId}">
                        <h3>${escapeHtml(card.title)}</h3>
                        <ul class="mini-card-list">
                          ${card.items.map((item) => `<li>${formatInline(item)}</li>`).join('')}
                        </ul>
                      </button>
                    `
                  )
                  .join('')}
              </div>
            </section>
          `
          : ''
      }

      <section class="reader-section">
        <h2 class="section-title">Быстрые переходы</h2>
        <div class="subject-link-grid">
          ${quickTopics
            .map(
              (topic) => `
                <button class="topic-card" type="button" data-topic-select="${topic.id}">
                  <span class="tiny-chip">${topic.minutes} мин</span>
                  <h3>${escapeHtml(topic.title)}</h3>
                </button>
              `
            )
            .join('')}
        </div>
      </section>
    </div>
  `;
}

function renderQuizOverlay() {
  if (!quizOverlayEl || !quizOverlayContentEl) {
    return;
  }

  quizOverlayEl.classList.toggle('is-active', state.quizOverlay);
  if (document.body && document.body.classList) {
    document.body.classList.toggle('quiz-open', state.quizOverlay);
  }

  if (!state.quizOverlay) {
    quizOverlayContentEl.innerHTML = '';
    return;
  }

  quizOverlayContentEl.innerHTML = quizSession ? renderQuizPlayer() : renderQuizSetup();
}

function renderQuizSetup() {
  const topic = getTopic(state.activeTopic);
  const totalSubjectQuestions = getSubjectQuizTotal();
  const topicChoiceTotal = buildTopicChoiceCards(topic).length;
  const topicTrueFalseTotal = buildTopicTrueFalseCards(topic).length;
  const subjectStartDisabled = totalSubjectQuestions < 10;

  return `
    <section class="quiz-panel">
      <div class="quiz-panel__top">
        <div>
          <p class="eyebrow">Отдельный режим</p>
          <h2 class="section-title">Квиз</h2>
        </div>
        <button class="ghost-button" type="button" data-close-quiz="true">Закрыть</button>
      </div>

      <div class="quiz-setup-tabs">
        <button class="quiz-setup-tab ${state.quizSetupMode === 'topic' ? 'is-active' : ''}" type="button" data-quiz-setup-mode="topic">
          По теме
        </button>
        <button class="quiz-setup-tab ${state.quizSetupMode === 'subjects' ? 'is-active' : ''}" type="button" data-quiz-setup-mode="subjects">
          По предметам
        </button>
      </div>

      <article class="quiz-setup-card">
        <h3>Режим карточек</h3>
        <div class="quiz-mode-bar">
          <button class="quiz-mode-button ${state.quizQuestionStyle === 'mixed' ? 'is-active' : ''}" type="button" data-quiz-style="mixed">
            Смешанный
          </button>
          <button class="quiz-mode-button ${state.quizQuestionStyle === 'choice' ? 'is-active' : ''}" type="button" data-quiz-style="choice">
            Тест
          </button>
          <button class="quiz-mode-button ${state.quizQuestionStyle === 'truefalse' ? 'is-active' : ''}" type="button" data-quiz-style="truefalse">
            Правда / неправда
          </button>
        </div>
      </article>

      ${
        state.quizSetupMode === 'topic'
          ? `
            <article class="quiz-setup-card">
              <p class="eyebrow">Текущая тема</p>
              <h3>${escapeHtml(topic.title)}</h3>
              <p class="quiz-setup-copy">${escapeHtml(topic.summary)}</p>
              <div class="quiz-session-meta">
                <span class="tiny-chip">Тестовых: ${topicChoiceTotal}</span>
                <span class="tiny-chip">Свайп-карточек: ${topicTrueFalseTotal}</span>
                <span class="tiny-chip">Минимум в раунде: 10</span>
              </div>

              <label class="quiz-count-control">
                <span>Карточек в квизе</span>
                <input type="number" min="10" max="30" step="1" value="${state.quizTopicCount}" data-quiz-topic-count>
              </label>

              <p class="quiz-setup-note">Для каждой темы я собираю минимум 10 карточек: тестовые, правда/неправда и распознавание формул.</p>
              <button class="quiz-start-button" type="button" data-start-topic-quiz="true">
                Начать квиз по теме
              </button>
            </article>
          `
          : `
            <article class="quiz-setup-card">
              <p class="eyebrow">Смешанный квиз</p>
              <h3>Настрой количество вопросов по предметам</h3>
              <div class="quiz-subject-grid">
                ${subjects
                  .map(
                    (subject) => `
                      <label class="quiz-subject-row">
                        <span class="subject-chip" style="background:${subject.softColor}; color:${subject.color}; border-color:${subject.softColor};">
                          ${escapeHtml(subject.title)}
                        </span>
                        <input
                          type="number"
                          min="0"
                          max="40"
                          step="1"
                          value="${Number(state.quizSubjectCounts[subject.id] || 0)}"
                          data-quiz-subject-count="${subject.id}"
                        >
                      </label>
                    `
                  )
                  .join('')}
              </div>

              <p class="quiz-setup-note">
                Сейчас выбрано ${totalSubjectQuestions} вопросов.
                ${subjectStartDisabled ? 'Для старта нужно выбрать хотя бы 10 вопросов.' : 'Можно смешать предметы как угодно.'}
              </p>
              <button class="quiz-start-button" type="button" data-start-subject-quiz="true" ${subjectStartDisabled ? 'disabled' : ''}>
                Начать смешанный квиз
              </button>
            </article>
          `
      }
    </section>
  `;
}

function renderQuizPlayer() {
  const answeredCount = Object.keys(quizSession.answers).length;
  const correctCount = Object.values(quizSession.answers).filter(Boolean).length;
  const progress = quizSession.cards.length ? Math.round((answeredCount / quizSession.cards.length) * 100) : 0;
  const finished = Boolean(quizSession.finished);
  const card = quizSession.cards[quizSession.index];

  return `
    <section class="quiz-panel quiz-panel--play">
      <div class="quiz-panel__top">
        <div>
          <p class="eyebrow">${escapeHtml(quizSession.title)}</p>
          <h2 class="section-title">${quizSession.mode === 'topic' ? 'Квиз по теме' : 'Квиз по предметам'}</h2>
        </div>
        <div class="reader-chips">
          <span class="tiny-chip">${quizSession.index + 1} / ${quizSession.cards.length}</span>
          <button class="ghost-button" type="button" data-stop-quiz="true">Выход</button>
        </div>
      </div>

      <div class="quiz-progress">
        <div class="quiz-progress__bar" style="width:${progress}%"></div>
      </div>

      <div class="quiz-session-meta">
        <span class="tiny-chip">Отвечено: ${answeredCount}</span>
        <span class="tiny-chip">Верно: ${correctCount}</span>
        <span class="tiny-chip">${finished ? 'Раунд завершён' : card.type === 'choice' ? 'Тест' : 'Правда / неправда'}</span>
      </div>

      ${
        finished
          ? renderQuizFinish(answeredCount, correctCount)
          : `
            ${card.type === 'choice' ? renderSessionChoiceCard(card) : renderSessionTrueFalseCard(card)}

            <div class="quiz-session-nav">
              <button class="ghost-button" type="button" data-session-nav="prev" ${quizSession.index === 0 ? 'disabled' : ''}>Назад</button>
              <button class="ghost-button" type="button" data-session-restart="true">Заново</button>
              <button class="ghost-button" type="button" data-session-settings="true">Настройки</button>
              <button class="ghost-button" type="button" data-session-nav="next" ${quizSession.index === quizSession.cards.length - 1 ? 'disabled' : ''}>Дальше</button>
            </div>
          `
      }
    </section>
  `;
}

function renderQuizFinish(answeredCount, correctCount) {
  const total = quizSession.cards.length || 1;
  const percent = Math.round((correctCount / total) * 100);
  const mistakes = quizSession.cards
    .filter((card) => quizSession.answers[card.id] && !quizSession.answers[card.id].correct)
    .slice(0, 5);

  return `
    <article class="quiz-session-card quiz-finish-card">
      <p class="eyebrow">Результат</p>
      <h3>Квиз завершён</h3>
      <div class="quiz-finish-score">${percent}%</div>
      <div class="quiz-session-meta">
        <span class="tiny-chip">Всего: ${total}</span>
        <span class="tiny-chip">Отвечено: ${answeredCount}</span>
        <span class="tiny-chip">Верно: ${correctCount}</span>
      </div>
      ${
        mistakes.length
          ? `
            <div class="quiz-finish-mistakes">
              <h4>Что стоит повторить</h4>
              <ul class="rule-list">
                ${mistakes
                  .map(
                    (card) => `
                      <li>
                        <span class="syntax-term">${escapeHtml(card.topicTitle || quizSession.title)}</span>
                        ${formatInline(card.type === 'choice' ? card.prompt : card.statement)}
                      </li>
                    `
                  )
                  .join('')}
              </ul>
            </div>
          `
          : '<p class="quiz-setup-note">Ошибок нет. Можно переходить к следующей теме или запустить более длинный раунд.</p>'
      }
      <div class="quiz-session-nav">
        <button class="ghost-button" type="button" data-session-restart="true">Пройти заново</button>
        <button class="ghost-button" type="button" data-session-settings="true">Новый квиз</button>
        <button class="quiz-start-button" type="button" data-stop-quiz="true">Закрыть</button>
      </div>
    </article>
  `;
}

function renderSessionChoiceCard(card) {
  const response = quizSession.answers[card.id];
  const answered = Boolean(response);

  return `
    <article class="quiz-session-card">
      <div class="quiz-head">
        <h3>${escapeHtml(card.prompt)}</h3>
        <div class="reader-chips">
          <span class="subject-chip" style="background:${card.subjectSoftColor}; color:${card.subjectColor}; border-color:${card.subjectSoftColor};">
            ${escapeHtml(card.subjectTitle)}
          </span>
          <span class="tiny-chip">${escapeHtml(card.topicTitle || '')}</span>
        </div>
      </div>

      <div class="quiz-options">
        ${card.options
          .map((option, index) => {
            const classNames = ['quiz-option'];
            if (answered && index === response.selected) {
              classNames.push('is-selected');
            }
            if (answered && index === card.answerIndex) {
              classNames.push('is-correct');
            }
            if (answered && index === response.selected && index !== card.answerIndex) {
              classNames.push('is-wrong');
            }

            return `
              <button class="${classNames.join(' ')}" type="button" data-session-choice="${card.id}:${index}" ${answered ? 'disabled' : ''}>
                ${formatInline(option)}
              </button>
            `;
          })
          .join('')}
      </div>

      ${
        answered
          ? `
            <div class="swipe-result ${response.correct ? 'is-correct' : 'is-wrong'}">
              <span class="feedback-badge ${response.correct ? 'is-correct' : 'is-wrong'}">${response.correct ? 'Верно' : 'Нужно ещё раз'}</span>
              <p class="quiz-explain">${formatInline(card.explain || '')}</p>
            </div>
          `
          : ''
      }
    </article>
  `;
}

function renderSessionTrueFalseCard(card) {
  const response = quizSession.answers[card.id];
  const answered = Boolean(response);

  return `
    <article class="quiz-session-card">
      <div class="quiz-head">
        <h3>${escapeHtml(card.prompt)}</h3>
        <div class="reader-chips">
          <span class="subject-chip" style="background:${card.subjectSoftColor}; color:${card.subjectColor}; border-color:${card.subjectSoftColor};">
            ${escapeHtml(card.subjectTitle)}
          </span>
          <span class="tiny-chip">${escapeHtml(card.topicTitle || '')}</span>
        </div>
      </div>

      <div class="swipe-hint">
        <span class="swipe-hint__left">Влево = неправда</span>
        <span class="swipe-hint__right">Вправо = правда</span>
      </div>

      <div class="swipe-stage">
        <div class="swipe-mark swipe-mark--left">Неправда</div>
        <div class="swipe-mark swipe-mark--right">Правда</div>
        <div
          class="swipe-card"
          data-session-swipe="${card.id}"
          data-answered="${answered ? '1' : '0'}"
        >
          <p class="swipe-card__statement">${formatInline(card.statement)}</p>
        </div>
      </div>

      <div class="swipe-actions">
        <button class="quiz-option" type="button" data-session-truefalse="${card.id}:0" ${answered ? 'disabled' : ''}>Неправда</button>
        <button class="quiz-option" type="button" data-session-truefalse="${card.id}:1" ${answered ? 'disabled' : ''}>Правда</button>
      </div>

      ${
        answered
          ? `
            <div class="swipe-result ${response.correct ? 'is-correct' : 'is-wrong'}">
              <span class="feedback-badge ${response.correct ? 'is-correct' : 'is-wrong'}">${response.correct ? 'Верно' : 'Нужно ещё раз'}</span>
              <p class="quiz-explain">${formatInline(card.explain || '')}</p>
            </div>
          `
          : ''
      }
    </article>
  `;
}

function getSubjectQuizTotal() {
  return subjects.reduce((sum, subject) => sum + Math.max(0, Number(state.quizSubjectCounts[subject.id] || 0)), 0);
}

function startTopicQuizSession() {
  const topic = getTopic(state.activeTopic);
  const cards = buildTopicQuizDeck(topic, Math.max(10, Number(state.quizTopicCount) || 10), state.quizQuestionStyle);

  quizSession = {
    mode: 'topic',
    title: topic.title,
    config: {
      mode: 'topic',
      topicId: topic.id,
      count: Math.max(10, Number(state.quizTopicCount) || 10),
      style: state.quizQuestionStyle
    },
    cards,
    index: 0,
    answers: {},
    finished: false
  };

  renderQuizOverlay();
  saveState();
}

function startSubjectQuizSession() {
  const total = getSubjectQuizTotal();
  if (total < 10) {
    showToast('Для квиза по предметам выбери хотя бы 10 вопросов.');
    return;
  }

  const counts = Object.fromEntries(
    subjects.map((subject) => [subject.id, Math.max(0, Number(state.quizSubjectCounts[subject.id] || 0))])
  );

  const cards = buildSubjectQuizDeck(counts, state.quizQuestionStyle);

  quizSession = {
    mode: 'subjects',
    title: 'Смешанный квиз',
    config: {
      mode: 'subjects',
      counts,
      style: state.quizQuestionStyle
    },
    cards,
    index: 0,
    answers: {},
    finished: false
  };

  renderQuizOverlay();
  saveState();
}

function restartQuizSession() {
  if (!quizSession || !quizSession.config) {
    return;
  }

  const config = quizSession.config;

  if (config.mode === 'topic') {
    const topic = getTopic(config.topicId);
    quizSession = {
      ...quizSession,
      title: topic.title,
      cards: buildTopicQuizDeck(topic, config.count, config.style),
      index: 0,
      answers: {},
      finished: false
    };
  } else {
    quizSession = {
      ...quizSession,
      cards: buildSubjectQuizDeck(config.counts, config.style),
      index: 0,
      answers: {},
      finished: false
    };
  }

  renderQuizOverlay();
}

function buildSubjectQuizDeck(counts, style) {
  const cards = [];

  subjects.forEach((subject) => {
    const requested = Math.max(0, Number(counts[subject.id] || 0));
    if (!requested) {
      return;
    }

    const pool = shuffle(
      subject.topics.flatMap((topic) => buildTopicQuizPool(topic, style))
    );

    cards.push(...takeCards(pool, requested));
  });

  return shuffle(cards).map((card, index) => ({ ...card, id: `${card.id}::mix${index}` }));
}

function buildTopicQuizDeck(topic, count, style) {
  const pool = buildTopicQuizPool(topic, style);
  return takeCards(pool, Math.max(10, count));
}

function buildTopicQuizPool(topic, style) {
  const choiceCards = buildTopicChoiceCards(topic);
  const trueFalseCards = buildTopicTrueFalseCards(topic);

  if (style === 'choice') {
    return choiceCards;
  }

  if (style === 'truefalse') {
    return trueFalseCards;
  }

  return shuffle([...choiceCards, ...trueFalseCards]);
}

function buildTopicChoiceCards(topic) {
  const cards = [];
  const subject = getSubject(topic.subjectId);
  const siblingFacts = getTopicFactsForSubject(subject, topic.id);
  const facts = getTopicFacts(topic);
  const templates = [
    `Что относится к теме «${topic.title}»?`,
    `Выбери карточку по теме «${topic.title}».`,
    `Что нужно помнить в теме «${topic.title}»?`
  ];

  (topic.miniTest || []).forEach((item, index) => {
    cards.push({
      id: `choice:base:${topic.id}:${index}`,
      type: 'choice',
      prompt: item.question,
      options: item.options || [],
      answerIndex: item.answer,
      explain: item.explain || item.answerText || '',
      topicTitle: topic.title,
      subjectTitle: topic.subjectTitle,
      subjectColor: topic.color,
      subjectSoftColor: topic.softColor
    });
  });

  facts.slice(0, 12).forEach((fact, index) => {
    const distractors = takeRandom(
      siblingFacts.filter((item) => item.text !== fact.text),
      3
    ).map((item) => item.text);

    if (distractors.length < 3) {
      return;
    }

    const options = shuffle([fact.text, ...distractors]);
    cards.push({
      id: `choice:auto:${topic.id}:${index}`,
      type: 'choice',
      prompt: templates[index % templates.length],
      options,
      answerIndex: options.indexOf(fact.text),
      explain: `Это относится к теме «${topic.title}».`,
      topicTitle: topic.title,
      subjectTitle: topic.subjectTitle,
      subjectColor: topic.color,
      subjectSoftColor: topic.softColor
    });
  });

  return shuffle(cards);
}

function buildTopicTrueFalseCards(topic) {
  const cards = [];
  const subject = getSubject(topic.subjectId);
  const facts = getTopicFacts(topic);
  const siblingFacts = getTopicFactsForSubject(subject, topic.id);

  (topic.trueFalse || []).forEach((item, index) => {
    cards.push({
      id: `tf:base:${topic.id}:${index}`,
      type: 'truefalse',
      prompt: `Тема: ${topic.title}`,
      statement: item.statement,
      correctValue: item.answer ? 1 : 0,
      explain: item.explain || '',
      topicTitle: topic.title,
      subjectTitle: topic.subjectTitle,
      subjectColor: topic.color,
      subjectSoftColor: topic.softColor
    });
  });

  facts.slice(0, 6).forEach((fact, index) => {
    cards.push({
      id: `tf:true:${topic.id}:${index}`,
      type: 'truefalse',
      prompt: `Это относится к теме «${topic.title}»?`,
      statement: fact.text,
      correctValue: 1,
      explain: `Да, это часть темы «${topic.title}».`,
      topicTitle: topic.title,
      subjectTitle: topic.subjectTitle,
      subjectColor: topic.color,
      subjectSoftColor: topic.softColor
    });
  });

  siblingFacts.slice(0, 6).forEach((fact, index) => {
    cards.push({
      id: `tf:false:${topic.id}:${index}`,
      type: 'truefalse',
      prompt: `Это относится к теме «${topic.title}»?`,
      statement: fact.text,
      correctValue: 0,
      explain: `Нет, это относится к теме «${fact.topicTitle}».`,
      topicTitle: topic.title,
      subjectTitle: topic.subjectTitle,
      subjectColor: topic.color,
      subjectSoftColor: topic.softColor
    });
  });

  return shuffle(cards);
}

function getTopicFacts(topic) {
  const seen = new Set();
  const normalizeFact = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const push = (target, items, kind) => {
    items.forEach((text) => {
      const normalized = normalizeFact(text);
      if (!normalized || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      target.push({
        subjectId: topic.subjectId,
        subjectTitle: topic.subjectTitle,
        topicId: topic.id,
        topicTitle: topic.title,
        text: normalized,
        kind
      });
    });
  };

  const facts = [];

  push(facts, [topic.summary, topic.examFocus], 'summary');
  push(facts, (topic.formulas || []).slice(0, 6), 'formula');
  push(
    facts,
    (topic.theory || []).flatMap((section) => (section.points || []).slice(0, 3)).slice(0, 6),
    'theory'
  );
  push(
    facts,
    (topic.examples || []).flatMap((example) => (example.items || []).slice(0, 2)).slice(0, 6),
    'example'
  );
  push(facts, (topic.checklist || []).slice(0, 3), 'checklist');
  push(facts, (topic.hacks || []).slice(0, 3), 'hack');
  push(facts, (topic.pitfalls || []).slice(0, 2), 'pitfall');
  push(
    facts,
    getTables(topic)
      .flatMap((table) => (table.rows || []).slice(0, 3))
      .map((row) => row.join(' — '))
      .slice(0, 6),
    'table'
  );
  push(
    facts,
    (topic.tasks || [])
      .flatMap((task) => [task.title, task.answer, ...(task.steps || []).slice(0, 2)])
      .slice(0, 6),
    'task'
  );

  return facts;
}

function getTopicFactsForSubject(subject, excludeTopicId) {
  return shuffle(
    subject.topics
      .filter((topic) => topic.id !== excludeTopicId)
      .flatMap((topic) => getTopicFacts(topic))
  );
}

function takeCards(pool, count) {
  const result = [];
  let round = 0;

  while (result.length < count && pool.length) {
    const shuffled = shuffle(pool).map((card, index) => ({
      ...card,
      id: `${card.id}::${round}:${index}`
    }));
    result.push(...shuffled);
    round += 1;
  }

  return result.slice(0, count);
}

function shuffle(items) {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}

function takeRandom(items, count) {
  return shuffle(items).slice(0, count);
}

function answerSessionChoice(cardId, selected) {
  if (!quizSession) {
    return;
  }

  const card = quizSession.cards.find((item) => item.id === cardId);
  if (!card || quizSession.answers[cardId]) {
    return;
  }

  quizSession.answers[cardId] = {
    selected,
    correct: selected === card.answerIndex
  };
  quizSession.finished = Object.keys(quizSession.answers).length >= quizSession.cards.length;
  renderQuizOverlay();
}

function answerSessionTrueFalse(cardId, selected) {
  if (!quizSession) {
    return;
  }

  const card = quizSession.cards.find((item) => item.id === cardId);
  if (!card || quizSession.answers[cardId]) {
    return;
  }

  quizSession.answers[cardId] = {
    selected,
    correct: selected === card.correctValue
  };
  quizSession.finished = Object.keys(quizSession.answers).length >= quizSession.cards.length;
  renderQuizOverlay();
}

function renderTheory(topic) {
  if (!(topic.theory && topic.theory.length)) {
    return '';
  }

  return `
    <section class="reader-section">
      <h2 class="section-title">Теория</h2>
      <div class="content-grid">
        ${topic.theory
          .map(
            (section) => `
              <article class="subsection">
                <h3>${escapeHtml(section.title)}</h3>
                ${renderList(section.points || [], 'rule-list')}
              </article>
            `
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderFormulaGrid(topic) {
  if (!(topic.formulas && topic.formulas.length)) {
    return '';
  }

  return `
    <section class="reader-section">
      <h2 class="section-title">Главное</h2>
      <div class="formula-grid">
        ${topic.formulas
          .map(
            (formula) => `
              <article class="formula-card">
                <p class="formula-line">${formatInline(formula)}</p>
              </article>
            `
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderExamples(topic) {
  const examples = topic.examples || [];
  if (!examples.length) {
    return '';
  }

  return `
    <section class="reader-section">
      <h2 class="section-title">Примеры</h2>
      <div class="example-grid">
        ${examples
          .map(
            (example) => `
              <article class="example-card">
                <h3>${escapeHtml(example.title)}</h3>
                <ul>
                  ${(example.items || []).map((item) => `<li>${formatInline(item)}</li>`).join('')}
                </ul>
              </article>
            `
          )
          .join('')}
      </div>
    </section>
  `;
}

function getTables(topic) {
  if (Array.isArray(topic.tables) && topic.tables.length) {
    return topic.tables;
  }

  if (topic.table) {
    return [topic.table];
  }

  return [];
}

function renderTables(topic) {
  const tables = getTables(topic);
  if (!tables.length) {
    return '';
  }

  return `
    <section class="reader-section">
      <h2 class="section-title">Таблицы</h2>
      <div class="table-grid">
        ${tables.map((table) => renderTableCard(table)).join('')}
      </div>
    </section>
  `;
}

function renderTableCard(table) {
  return `
    <article class="table-card">
      <h3>${escapeHtml(table.title || 'Таблица')}</h3>
      <table class="data-table">
        <thead>
          <tr>
            ${(table.headers || []).map((header) => `<th>${formatInline(header)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${(table.rows || [])
            .map(
              (row) => `
                <tr>
                  ${row.map((cell) => `<td>${formatInline(cell)}</td>`).join('')}
                </tr>
              `
            )
            .join('')}
        </tbody>
      </table>
      ${table.note ? `<p class="table-note">${formatInline(table.note)}</p>` : ''}
    </article>
  `;
}

function renderDiagrams(topic, subject) {
  if (!(topic.diagrams && topic.diagrams.length)) {
    return '';
  }

  return `
    <section class="reader-section">
      <h2 class="section-title">Схемы</h2>
      <div class="diagram-grid">
        ${topic.diagrams
          .map(
            (diagram) => `
              <article class="diagram-card">
                <h3>${escapeHtml(diagram.title || 'Схема')}</h3>
                ${renderDiagram(diagram, subject.color)}
                ${diagram.caption ? `<p class="diagram-caption">${formatInline(diagram.caption)}</p>` : ''}
              </article>
            `
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderTasks(topic) {
  if (!(topic.tasks && topic.tasks.length)) {
    return '';
  }

  return `
    <section class="reader-section">
      <h2 class="section-title">Разбор</h2>
      <div class="task-stack">
        ${topic.tasks
          .map(
            (task) => `
              <details class="task-card">
                <summary>${escapeHtml(task.title)}</summary>
                <div class="task-answer">
                  <p>${escapeHtml(task.prompt)}</p>
                  <p><strong>Ответ:</strong> ${formatInline(task.answer)}</p>
                  ${renderList(task.steps || [], 'step-list')}
                </div>
              </details>
            `
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderSupport(topic) {
  const cards = [];

  if (topic.hacks && topic.hacks.length) {
    cards.push(`
      <article class="subsection">
        <h3>Лайфхаки</h3>
        ${renderList(topic.hacks, 'hack-list')}
      </article>
    `);
  }

  if (topic.pitfalls && topic.pitfalls.length) {
    cards.push(`
      <article class="subsection">
        <h3>Ловушки</h3>
        ${renderList(topic.pitfalls.map((item) => `!!${item}!!`), 'pitfall-list')}
      </article>
    `);
  }

  if (topic.checklist && topic.checklist.length) {
    cards.push(`
      <article class="subsection">
        <h3>Проверка себя</h3>
        ${renderList(topic.checklist, 'checklist')}
      </article>
    `);
  }

  if (!cards.length) {
    return '';
  }

  return `
    <section class="reader-section">
      <h2 class="section-title">Коротко</h2>
      <div class="content-grid">
        ${cards.join('')}
      </div>
    </section>
  `;
}

function renderQuiz(topic) {
  const modes = getAvailableQuizModes(topic);
  if (!modes.length) {
    return '';
  }

  const activeMode = getCurrentQuizMode(topic);
  const body = activeMode === 'truefalse'
    ? renderTrueFalseDeck(topic)
    : (topic.miniTest || []).map((item, index) => renderQuizCard(topic.id, item, index)).join('');

  return `
    <section class="reader-section">
      <div class="quiz-section-head">
        <h2 class="section-title">Проверка</h2>
        ${
          modes.length > 1
            ? `
              <div class="quiz-mode-bar">
                ${modes
                  .map(
                    (mode) => `
                      <button
                        class="quiz-mode-button ${mode === activeMode ? 'is-active' : ''}"
                        type="button"
                        data-quiz-mode="${topic.id}:${mode}"
                      >
                        ${mode === 'test' ? 'Тест' : 'Правда / неправда'}
                      </button>
                    `
                  )
                  .join('')}
              </div>
            `
            : ''
        }
      </div>
      <div class="quiz-stack">
        ${body}
      </div>
    </section>
  `;
}

function renderTrueFalseDeck(topic) {
  const items = topic.trueFalse || [];
  if (!items.length) {
    return '';
  }

  const index = getSwipeCardIndex(topic);
  const answeredCount = countTrueFalseAnswered(topic);
  const correctCount = countTrueFalseCorrect(topic);

  if (answeredCount >= items.length || index >= items.length) {
    return `
      <article class="quiz-card swipe-summary">
        <div class="quiz-head">
          <h3>Раунд завершён</h3>
          <span class="feedback-badge is-correct">${correctCount} из ${items.length}</span>
        </div>
        <p class="quiz-explain">Можно запустить этот режим заново и пройти карточки ещё раз.</p>
        <div class="swipe-actions">
          <button class="quiz-option" type="button" data-reset-truefalse="${topic.id}">Пройти заново</button>
        </div>
      </article>
    `;
  }

  const item = items[index];
  const key = `tf:${topic.id}:${index}`;
  const selected = state.quiz[key];
  const answered = Number.isInteger(selected);
  const correctValue = item.answer ? 1 : 0;
  const isCorrect = answered && selected === correctValue;

  return `
    <article class="quiz-card">
      <div class="quiz-head">
        <h3>Карточка ${index + 1} из ${items.length}</h3>
        <span class="tiny-chip">${answeredCount} / ${items.length}</span>
      </div>

      <div class="swipe-hint">
        <span class="swipe-hint__left">Влево = неправда</span>
        <span class="swipe-hint__right">Вправо = правда</span>
      </div>

      <div class="swipe-stage">
        <div class="swipe-mark swipe-mark--left">Неправда</div>
        <div class="swipe-mark swipe-mark--right">Правда</div>
        <div
          class="swipe-card"
          data-swipe-card="${key}"
          data-topic-id="${topic.id}"
          data-card-index="${index}"
          data-answered="${answered ? '1' : '0'}"
        >
          <p class="swipe-card__statement">${formatInline(item.statement)}</p>
        </div>
      </div>

      <div class="swipe-actions">
        ${renderTrueFalseButton(key, 0, selected, correctValue, 'Неправда', answered)}
        ${renderTrueFalseButton(key, 1, selected, correctValue, 'Правда', answered)}
      </div>

      ${
        answered
          ? `
            <div class="swipe-result ${isCorrect ? 'is-correct' : 'is-wrong'}">
              <span class="feedback-badge ${isCorrect ? 'is-correct' : 'is-wrong'}">${isCorrect ? 'Верно' : 'Нужно ещё раз'}</span>
              <p class="quiz-explain">${formatInline(item.explain || '')}</p>
              <div class="swipe-actions">
                <button class="quiz-option" type="button" data-next-truefalse="${topic.id}">
                  ${index === items.length - 1 ? 'Завершить' : 'Следующая карточка'}
                </button>
                <button class="quiz-option" type="button" data-reset-truefalse="${topic.id}">Сначала</button>
              </div>
            </div>
          `
          : ''
      }
    </article>
  `;
}

function renderQuizCard(topicId, item, index) {
  const key = `mc:${topicId}:${index}`;
  const selected = state.quiz[key];
  const answered = Number.isInteger(selected);
  const isCorrect = answered && selected === item.answer;

  return `
    <article class="quiz-card">
      <div class="quiz-head">
        <h3>${escapeHtml(item.question)}</h3>
        ${
          answered
            ? `<span class="feedback-badge ${isCorrect ? 'is-correct' : 'is-wrong'}">${isCorrect ? 'Верно' : 'Ещё раз'}</span>`
            : ''
        }
      </div>
      <div class="quiz-options">
        ${(item.options || [])
          .map((option, optionIndex) => {
            const classNames = ['quiz-option'];
            if (answered && optionIndex === selected) {
              classNames.push('is-selected');
            }
            if (answered && optionIndex === item.answer) {
              classNames.push('is-correct');
            }
            if (answered && optionIndex === selected && optionIndex !== item.answer) {
              classNames.push('is-wrong');
            }

            return `
              <button class="${classNames.join(' ')}" type="button" data-quiz-select="${key}:${optionIndex}">
                ${formatInline(option)}
              </button>
            `;
          })
          .join('')}
      </div>
      ${answered ? `<p class="quiz-explain">${formatInline(item.explain || '')}</p>` : ''}
    </article>
  `;
}

function renderTrueFalseCard(topicId, item, index) {
  const key = `tf:${topicId}:${index}`;
  const selected = state.quiz[key];
  const answered = Number.isInteger(selected);
  const correctValue = item.answer ? 1 : 0;
  const isCorrect = answered && selected === correctValue;

  return `
    <article class="quiz-card">
      <div class="quiz-head">
        <h3>${formatInline(item.statement)}</h3>
        ${
          answered
            ? `<span class="feedback-badge ${isCorrect ? 'is-correct' : 'is-wrong'}">${isCorrect ? 'Верно' : 'Проверь'}</span>`
            : ''
        }
      </div>
      <div class="quiz-options quiz-options--binary">
        ${renderTrueFalseButton(key, 1, selected, correctValue, 'Правда', answered)}
        ${renderTrueFalseButton(key, 0, selected, correctValue, 'Неправда', answered)}
      </div>
      ${answered ? `<p class="quiz-explain">${formatInline(item.explain || '')}</p>` : ''}
    </article>
  `;
}

function renderTrueFalseButton(key, value, selected, correctValue, label, answered) {
  const classNames = ['quiz-option'];

  if (answered && value === selected) {
    classNames.push('is-selected');
  }
  if (answered && value === correctValue) {
    classNames.push('is-correct');
  }
  if (answered && value === selected && value !== correctValue) {
    classNames.push('is-wrong');
  }

  return `
    <button class="${classNames.join(' ')}" type="button" data-truefalse-select="${key}:${value}">
      ${label}
    </button>
  `;
}

function getAvailableQuizModes(topic) {
  const modes = [];

  if (topic.miniTest && topic.miniTest.length) {
    modes.push('test');
  }

  if (topic.trueFalse && topic.trueFalse.length) {
    modes.push('truefalse');
  }

  return modes;
}

function getCurrentQuizMode(topic) {
  const modes = getAvailableQuizModes(topic);
  const savedMode = state.quizMode[topic.id];

  if (savedMode && modes.includes(savedMode)) {
    return savedMode;
  }

  return modes[0] || 'test';
}

function countTrueFalseAnswered(topic) {
  return (topic.trueFalse || []).filter((item, index) => Number.isInteger(state.quiz[`tf:${topic.id}:${index}`])).length;
}

function countTrueFalseCorrect(topic) {
  return (topic.trueFalse || []).filter((item, index) => {
    const value = state.quiz[`tf:${topic.id}:${index}`];
    return Number.isInteger(value) && value === (item.answer ? 1 : 0);
  }).length;
}

function getSwipeCardIndex(topic) {
  const total = (topic.trueFalse || []).length;
  if (!total) {
    return 0;
  }

  const stored = state.swipeIndex[topic.id] ?? 0;
  return Math.max(0, Math.min(stored, total));
}

function recordTrueFalseAnswer(topicId, index, selected) {
  state.quiz[`tf:${topicId}:${index}`] = selected;
  renderDetail();
  saveState();
}

function advanceTrueFalse(topicId) {
  const topic = getTopic(topicId);
  const total = (topic.trueFalse || []).length;
  const current = getSwipeCardIndex(topic);
  state.swipeIndex[topicId] = Math.min(current + 1, total);
  renderDetail();
  saveState();
}

function resetTrueFalse(topicId) {
  const topic = getTopic(topicId);
  (topic.trueFalse || []).forEach((item, index) => {
    delete state.quiz[`tf:${topicId}:${index}`];
  });
  state.swipeIndex[topicId] = 0;
  renderDetail();
  saveState();
}

function updateSwipeVisuals(element, delta) {
  const limited = Math.max(-160, Math.min(160, delta));
  const leftMark = element.parentElement ? element.parentElement.querySelector('.swipe-mark--left') : null;
  const rightMark = element.parentElement ? element.parentElement.querySelector('.swipe-mark--right') : null;

  element.style.transform = `translateX(${limited}px) rotate(${limited / 18}deg)`;
  element.style.opacity = String(1 - Math.abs(limited) / 260);

  if (leftMark) {
    leftMark.style.opacity = limited < 0 ? String(Math.min(1, Math.abs(limited) / 90)) : '0.18';
  }

  if (rightMark) {
    rightMark.style.opacity = limited > 0 ? String(Math.min(1, Math.abs(limited) / 90)) : '0.18';
  }
}

function finishSwipeGesture() {
  if (!dragState) {
    return;
  }

  const { element } = dragState;
  const transform = element.style.transform || '';
  const match = transform.match(/translateX\((-?\d+(?:\.\d+)?)px\)/);
  const delta = match ? Number(match[1]) : 0;

  element.classList.remove('is-dragging');

  if (Math.abs(delta) >= 90) {
    if (dragState.mode === 'quiz-session') {
      answerSessionTrueFalse(dragState.cardId, delta > 0 ? 1 : 0);
    } else {
      recordTrueFalseAnswer(dragState.topicId, dragState.index, delta > 0 ? 1 : 0);
    }
  } else {
    updateSwipeVisuals(element, 0);
  }

  dragState = null;
}

function renderList(items, className) {
  if (!items.length) {
    return '';
  }

  return `
    <ul class="${className}">
      ${items.map((item) => `<li>${formatInline(item)}</li>`).join('')}
    </ul>
  `;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInline(value) {
  return escapeHtml(value ?? '')
    .replace(/\{\{(.+?)\}\}/g, '<span class="syntax-formula">$1</span>')
    .replace(/\[\[(.+?)\]\]/g, '<span class="syntax-term">$1</span>')
    .replace(/!!(.+?)!!/g, '<span class="syntax-warning">$1</span>')
    .replace(/~~(.+?)~~/g, '<span class="syntax-note">$1</span>')
    .replace(/\n/g, '<br>');
}

function renderDiagram(diagram, accent) {
  const stroke = accent || '#61bfff';
  const soft = 'rgba(255,255,255,0.08)';
  const text = '#dfe7f6';

  switch (diagram.type) {
    case 'flow':
      return renderFlowDiagram(diagram, stroke, text, soft);
    case 'scheme':
      return renderSchemeDiagram(diagram, stroke, text, soft);
    case 'triangle':
      return renderTriangleDiagram(diagram, stroke, text);
    case 'circle':
      return renderCircleDiagram(diagram, stroke, text);
    case 'axes-line':
      return renderAxesLineDiagram(diagram, stroke, text);
    case 'axes-line-double':
      return renderAxesLineDoubleDiagram(diagram, stroke, text);
    case 'axes-demand':
      return renderAxesDemandDiagram(diagram, stroke, text);
    case 'bar':
      return renderBarDiagram(diagram, stroke, text);
    case 'pyramid':
      return renderPyramidDiagram(diagram, stroke, text);
    default:
      return renderSchemeDiagram(diagram, stroke, text, soft);
  }
}

function renderFlowDiagram(diagram, stroke, text, soft) {
  const steps = diagram.steps || [];
  const width = 640;
  const gap = 14;
  const boxWidth = Math.max(106, Math.floor((width - 40 - Math.max(steps.length - 1, 0) * gap) / Math.max(steps.length, 1)));

  const nodes = steps
    .map((step, index) => {
      const x = 20 + index * (boxWidth + gap);
      const line = index < steps.length - 1
        ? `<line x1="${x + boxWidth}" y1="62" x2="${x + boxWidth + gap}" y2="62" stroke="${stroke}" stroke-width="2" />
           <polygon points="${x + boxWidth + gap},62 ${x + boxWidth + gap - 7},58 ${x + boxWidth + gap - 7},66" fill="${stroke}" />`
        : '';

      return `
        <rect x="${x}" y="40" width="${boxWidth}" height="44" rx="14" fill="${soft}" stroke="${stroke}" />
        <text x="${x + boxWidth / 2}" y="67" fill="${text}" font-size="14" text-anchor="middle">${escapeHtml(step)}</text>
        ${line}
      `;
    })
    .join('');

  return `<svg viewBox="0 0 640 124" role="img" aria-label="${escapeHtml(diagram.title || 'Схема')}">${nodes}</svg>`;
}

function renderSchemeDiagram(diagram, stroke, text, soft) {
  const items = diagram.items || [];
  const width = 640;
  const gap = 18;
  const boxWidth = Math.max(116, Math.floor((width - 40 - Math.max(items.length - 1, 0) * gap) / Math.max(items.length, 1)));
  const nodes = items
    .map((item, index) => {
      const x = 20 + index * (boxWidth + gap);
      return `
        <rect x="${x}" y="34" width="${boxWidth}" height="56" rx="16" fill="${soft}" stroke="${stroke}" />
        <text x="${x + boxWidth / 2}" y="66" fill="${text}" font-size="14" text-anchor="middle">${escapeHtml(item)}</text>
      `;
    })
    .join('');

  return `<svg viewBox="0 0 640 124" role="img" aria-label="${escapeHtml(diagram.title || 'Схема')}">${nodes}</svg>`;
}

function renderTriangleDiagram(diagram, stroke, text) {
  return `
    <svg viewBox="0 0 320 220" role="img" aria-label="${escapeHtml(diagram.title || 'Треугольник')}">
      <polygon points="160,28 44,188 276,188" fill="rgba(255,255,255,0.04)" stroke="${stroke}" stroke-width="3" />
      <path d="M96 188 L96 140 L132 140" fill="none" stroke="${stroke}" stroke-width="3" />
      <text x="160" y="20" fill="${text}" font-size="16" text-anchor="middle">${escapeHtml(diagram.topLabel || 'C')}</text>
      <text x="34" y="204" fill="${text}" font-size="16">${escapeHtml(diagram.leftLabel || 'A')}</text>
      <text x="282" y="204" fill="${text}" font-size="16">${escapeHtml(diagram.rightLabel || 'B')}</text>
      <text x="116" y="134" fill="${text}" font-size="15">${escapeHtml(diagram.centerLabel || '90°')}</text>
    </svg>
  `;
}

function renderCircleDiagram(diagram, stroke, text) {
  return `
    <svg viewBox="0 0 320 220" role="img" aria-label="${escapeHtml(diagram.title || 'Окружность')}">
      <circle cx="160" cy="110" r="70" fill="rgba(255,255,255,0.04)" stroke="${stroke}" stroke-width="3" />
      <circle cx="160" cy="110" r="4" fill="${stroke}" />
      <line x1="160" y1="110" x2="220" y2="70" stroke="${stroke}" stroke-width="3" />
      <line x1="90" y1="110" x2="230" y2="110" stroke="rgba(255,255,255,0.3)" stroke-width="2" stroke-dasharray="6 6" />
      <text x="150" y="104" fill="${text}" font-size="16">${escapeHtml(diagram.centerLabel || 'O')}</text>
      <text x="224" y="70" fill="${text}" font-size="15">${escapeHtml(diagram.radiusLabel || 'R')}</text>
      <text x="146" y="130" fill="${text}" font-size="15">${escapeHtml(diagram.diameterLabel || 'D')}</text>
    </svg>
  `;
}

function renderAxesLineDiagram(diagram, stroke, text) {
  return `
    <svg viewBox="0 0 320 220" role="img" aria-label="${escapeHtml(diagram.title || 'График')}">
      <line x1="50" y1="180" x2="280" y2="180" stroke="rgba(255,255,255,0.4)" stroke-width="2" />
      <line x1="50" y1="180" x2="50" y2="28" stroke="rgba(255,255,255,0.4)" stroke-width="2" />
      <line x1="80" y1="150" x2="245" y2="76" stroke="${stroke}" stroke-width="4" />
      <circle cx="180" cy="104" r="5" fill="${stroke}" />
      <text x="286" y="188" fill="${text}" font-size="15">${escapeHtml(diagram.xLabel || 'x')}</text>
      <text x="38" y="32" fill="${text}" font-size="15">${escapeHtml(diagram.yLabel || 'y')}</text>
    </svg>
  `;
}

function renderAxesLineDoubleDiagram(diagram, stroke, text) {
  return `
    <svg viewBox="0 0 320 220" role="img" aria-label="${escapeHtml(diagram.title || 'Графики')}">
      <line x1="50" y1="180" x2="280" y2="180" stroke="rgba(255,255,255,0.4)" stroke-width="2" />
      <line x1="50" y1="180" x2="50" y2="28" stroke="rgba(255,255,255,0.4)" stroke-width="2" />
      <line x1="84" y1="150" x2="250" y2="68" stroke="${stroke}" stroke-width="4" />
      <line x1="92" y1="58" x2="238" y2="166" stroke="#ffd98a" stroke-width="4" />
      <circle cx="168" cy="108" r="6" fill="#94f6cc" />
      <text x="286" y="188" fill="${text}" font-size="15">${escapeHtml(diagram.xLabel || 'x')}</text>
      <text x="38" y="32" fill="${text}" font-size="15">${escapeHtml(diagram.yLabel || 'y')}</text>
    </svg>
  `;
}

function renderAxesDemandDiagram(diagram, stroke, text) {
  return `
    <svg viewBox="0 0 320 220" role="img" aria-label="${escapeHtml(diagram.title || 'Спрос и предложение')}">
      <line x1="50" y1="180" x2="280" y2="180" stroke="rgba(255,255,255,0.4)" stroke-width="2" />
      <line x1="50" y1="180" x2="50" y2="28" stroke="rgba(255,255,255,0.4)" stroke-width="2" />
      <line x1="88" y1="60" x2="246" y2="158" stroke="#ffd98a" stroke-width="4" />
      <line x1="92" y1="150" x2="246" y2="62" stroke="${stroke}" stroke-width="4" />
      <text x="250" y="58" fill="${text}" font-size="14">Предложение</text>
      <text x="220" y="165" fill="${text}" font-size="14">Спрос</text>
      <text x="286" y="188" fill="${text}" font-size="15">${escapeHtml(diagram.xLabel || 'Количество')}</text>
      <text x="38" y="32" fill="${text}" font-size="15">${escapeHtml(diagram.yLabel || 'Цена')}</text>
    </svg>
  `;
}

function renderBarDiagram(diagram, stroke, text) {
  const values = diagram.values || [];
  const labels = diagram.labels || [];
  const max = Math.max(...values, 1);
  const bars = values
    .map((value, index) => {
      const x = 44 + index * 62;
      const height = (value / max) * 110;
      const y = 170 - height;
      return `
        <rect x="${x}" y="${y}" width="34" height="${height}" rx="10" fill="${stroke}" opacity="${0.78 + index * 0.04}" />
        <text x="${x + 17}" y="190" fill="${text}" font-size="13" text-anchor="middle">${escapeHtml(labels[index] || '')}</text>
        <text x="${x + 17}" y="${y - 8}" fill="${text}" font-size="12" text-anchor="middle">${escapeHtml(value)}</text>
      `;
    })
    .join('');

  return `
    <svg viewBox="0 0 320 220" role="img" aria-label="${escapeHtml(diagram.title || 'Диаграмма')}">
      <line x1="32" y1="176" x2="292" y2="176" stroke="rgba(255,255,255,0.4)" stroke-width="2" />
      <line x1="32" y1="176" x2="32" y2="32" stroke="rgba(255,255,255,0.4)" stroke-width="2" />
      ${bars}
    </svg>
  `;
}

function renderPyramidDiagram(diagram, stroke, text) {
  const levels = diagram.levels || [];
  const parts = levels
    .map((level, index) => {
      const width = 220 - index * 48;
      const x = 160 - width / 2;
      const y = 44 + index * 44;
      return `
        <rect x="${x}" y="${y}" width="${width}" height="34" rx="12" fill="rgba(255,255,255,0.05)" stroke="${stroke}" />
        <text x="160" y="${y + 22}" fill="${text}" font-size="14" text-anchor="middle">${escapeHtml(level)}</text>
      `;
    })
    .join('');

  return `<svg viewBox="0 0 320 220" role="img" aria-label="${escapeHtml(diagram.title || 'Схема')}">${parts}</svg>`;
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const openQuizButton = event.target.closest('[data-open-quiz]');
    if (openQuizButton || event.target === quizLauncherButton) {
      state.quizOverlay = true;
      quizSession = null;
      renderQuizOverlay();
      saveState();
      return;
    }

    const closeQuizButton = event.target.closest('[data-close-quiz]');
    if (closeQuizButton || event.target === quizOverlayEl) {
      state.quizOverlay = false;
      quizSession = null;
      renderQuizOverlay();
      saveState();
      return;
    }

    const quizSetupModeButton = event.target.closest('[data-quiz-setup-mode]');
    if (quizSetupModeButton) {
      state.quizSetupMode = quizSetupModeButton.dataset.quizSetupMode;
      renderQuizOverlay();
      saveState();
      return;
    }

    const quizStyleButton = event.target.closest('[data-quiz-style]');
    if (quizStyleButton) {
      state.quizQuestionStyle = quizStyleButton.dataset.quizStyle;
      renderQuizOverlay();
      saveState();
      return;
    }

    const startTopicQuizButton = event.target.closest('[data-start-topic-quiz]');
    if (startTopicQuizButton) {
      startTopicQuizSession();
      return;
    }

    const startSubjectQuizButton = event.target.closest('[data-start-subject-quiz]');
    if (startSubjectQuizButton) {
      startSubjectQuizSession();
      return;
    }

    const sessionChoiceButton = event.target.closest('[data-session-choice]');
    if (sessionChoiceButton && quizSession) {
      const parts = sessionChoiceButton.dataset.sessionChoice.split(':');
      const selected = Number(parts.pop());
      const cardId = parts.join(':');
      answerSessionChoice(cardId, selected);
      return;
    }

    const sessionTrueFalseButton = event.target.closest('[data-session-truefalse]');
    if (sessionTrueFalseButton && quizSession) {
      const parts = sessionTrueFalseButton.dataset.sessionTruefalse.split(':');
      const selected = Number(parts.pop());
      const cardId = parts.join(':');
      answerSessionTrueFalse(cardId, selected);
      return;
    }

    const sessionNavButton = event.target.closest('[data-session-nav]');
    if (sessionNavButton && quizSession) {
      if (sessionNavButton.dataset.sessionNav === 'prev') {
        quizSession.index = Math.max(0, quizSession.index - 1);
      } else {
        quizSession.index = Math.min(quizSession.cards.length - 1, quizSession.index + 1);
      }
      renderQuizOverlay();
      return;
    }

    const sessionRestartButton = event.target.closest('[data-session-restart]');
    if (sessionRestartButton && quizSession) {
      restartQuizSession();
      return;
    }

    const sessionSettingsButton = event.target.closest('[data-session-settings]');
    if (sessionSettingsButton) {
      quizSession = null;
      renderQuizOverlay();
      return;
    }

    const stopQuizButton = event.target.closest('[data-stop-quiz]');
    if (stopQuizButton) {
      state.quizOverlay = false;
      quizSession = null;
      renderQuizOverlay();
      saveState();
      return;
    }

    const subjectButton = event.target.closest('[data-subject-select]');
    if (subjectButton) {
      state.activeSubject = subjectButton.dataset.subjectSelect;
      state.drawerOpen = true;
      ensureSelection();
      renderAll();
      return;
    }

    const viewModeButton = event.target.closest('[data-view-mode]');
    if (viewModeButton) {
      state.viewMode = viewModeButton.dataset.viewMode;
      renderDetail();
      saveState();
      return;
    }

    const topicButton = event.target.closest('[data-topic-select]');
    if (topicButton) {
      state.activeTopic = topicButton.dataset.topicSelect;
      state.viewMode = 'topic';
      if (window.innerWidth < 1100) {
        state.drawerOpen = false;
      }
      renderAll();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const openDrawerTrigger = event.target.closest('[data-open-drawer]');
    if (openDrawerTrigger || event.target === openDrawerButton) {
      state.drawerOpen = true;
      renderDrawer();
      saveState();
      return;
    }

    if (event.target === closeDrawerButton || event.target === drawerBackdropEl) {
      state.drawerOpen = false;
      renderDrawer();
      saveState();
      return;
    }

    const quizButton = event.target.closest('[data-quiz-select]');
    if (quizButton) {
      const parts = quizButton.dataset.quizSelect.split(':');
      const selected = Number(parts.pop());
      state.quiz[parts.join(':')] = selected;
      renderDetail();
      saveState();
      return;
    }

    const trueFalseButton = event.target.closest('[data-truefalse-select]');
    if (trueFalseButton) {
      const parts = trueFalseButton.dataset.truefalseSelect.split(':');
      const selected = Number(parts.pop());
      const index = Number(parts.pop());
      const topicId = parts.pop();
      recordTrueFalseAnswer(topicId, index, selected);
      return;
    }

    const quizModeButton = event.target.closest('[data-quiz-mode]');
    if (quizModeButton) {
      const [topicId, mode] = quizModeButton.dataset.quizMode.split(':');
      state.quizMode[topicId] = mode;
      renderDetail();
      saveState();
      return;
    }

    const nextTrueFalseButton = event.target.closest('[data-next-truefalse]');
    if (nextTrueFalseButton) {
      advanceTrueFalse(nextTrueFalseButton.dataset.nextTruefalse);
      return;
    }

    const resetTrueFalseButton = event.target.closest('[data-reset-truefalse]');
    if (resetTrueFalseButton) {
      resetTrueFalse(resetTrueFalseButton.dataset.resetTruefalse);
    }
  });

  searchInput.addEventListener('input', (event) => {
    state.query = event.target.value;
    ensureSelection();
    renderAll();
  });

  quizOverlayContentEl.addEventListener('input', (event) => {
    const topicCountField = event.target.closest('[data-quiz-topic-count]');
    if (topicCountField) {
      state.quizTopicCount = Math.max(10, Math.min(30, Number(topicCountField.value) || 10));
      saveState();
      return;
    }

    const subjectCountField = event.target.closest('[data-quiz-subject-count]');
    if (subjectCountField) {
      const subjectId = subjectCountField.dataset.quizSubjectCount;
      state.quizSubjectCounts[subjectId] = Math.max(0, Math.min(40, Number(subjectCountField.value) || 0));
      renderQuizOverlay();
      saveState();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 1280 && !state.drawerOpen) {
      renderDrawer();
    }
  });

  detailEl.addEventListener('pointerdown', (event) => {
    const swipeCard = event.target.closest('[data-swipe-card]');
    if (!swipeCard || swipeCard.dataset.answered === '1') {
      return;
    }

    dragState = {
      element: swipeCard,
      topicId: swipeCard.dataset.topicId,
      index: Number(swipeCard.dataset.cardIndex),
      startX: event.clientX
    };

    swipeCard.classList.add('is-dragging');
  });

  window.addEventListener('pointermove', (event) => {
    if (!dragState) {
      return;
    }

    const delta = event.clientX - dragState.startX;
    updateSwipeVisuals(dragState.element, delta);
  });

  window.addEventListener('pointerup', () => {
    finishSwipeGesture();
  });

  window.addEventListener('pointercancel', () => {
    finishSwipeGesture();
  });

  quizOverlayContentEl.addEventListener('pointerdown', (event) => {
    const swipeCard = event.target.closest('[data-session-swipe]');
    if (!swipeCard || swipeCard.dataset.answered === '1' || !quizSession) {
      return;
    }

    dragState = {
      mode: 'quiz-session',
      element: swipeCard,
      cardId: swipeCard.dataset.sessionSwipe,
      startX: event.clientX
    };

    swipeCard.classList.add('is-dragging');
  });
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove('is-visible');
  }, 1800);
}

function registerServiceWorker() {
  const protocol = window.location && window.location.protocol ? window.location.protocol : '';
  const isFileMode = protocol === 'file:';

  if (!('serviceWorker' in navigator) || isFileMode) {
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      showToast('Не удалось включить офлайн-режим.');
    });
  });
}
