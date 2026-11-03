/* 政策匹配：企业资料助理在对话里收集信息和资料，交接给政策匹配顾问，由其在对话里逐项解析、列出政策。只在已收录的官方公开政策内按用户所选内容筛选排序，没有实时检索；文件只记录名称，不读取内容。 */
(() => {
  'use strict';

  const questions = [
    { key: 'type', label: '企业类型', options: ['有限责任公司', '股份有限公司', '国有企业', '外商投资企业', '合伙企业', '个人独资企业'] },
    { key: 'stage', label: '成长阶段', options: ['初创期（创业）', '成长期（成长）', '成熟期（做大做强）'] },
    { key: 'revenue', label: '营业收入', options: ['500万以下', '500-2000万', '2000-5000万', '5000万-1亿', '1-2亿', '2-5亿', '5-10亿', '10亿以上'] },
    { key: 'rd', label: '研发费占营业收入比重', options: ['2%以下', '2%-3%', '3%-4%', '4%-5%', '5%-10%', '10%-15%', '15%以上'] },
    { key: 'talent', label: '近3年有无引进人才', options: ['无', '有'] },
  ];
  const groups = [
    { title: '基本信息', keys: ['type'] },
    { title: '经营情况', keys: ['stage', 'revenue'] },
    { title: '研发与人才', keys: ['rd', 'talent'] },
  ];
  const stageDelay = 1000;
  const state = { taskId: '', phase: 'result', stage: 0, timer: 0, drawerReturn: null };

  const S = () => window.PolicyStore;
  const esc = value => window.PolicyUI.escape(value);
  const icon = name => window.PolicyUI.icon(name);
  const labelOf = key => questions.find(question => question.key === key).label;
  const answersOf = task => task?.intake?.answers || {};
  const filesOf = task => task?.intake?.files || [];
  const answeredCount = answers => questions.filter(question => answers[question.key]).length;
  const revealedCount = answers => {
    const firstOpen = questions.findIndex(question => !answers[question.key]);
    return firstOpen < 0 ? questions.length : firstOpen + 1;
  };
  const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hintText = answers => {
    const left = questions.length - answeredCount(answers);
    return left ? `再选 ${left} 项，匹配更准` : '都选好了';
  };

  const publicPolicies = () => window.PolicyPublicPolicies || [];
  const pad = value => String(value).padStart(2, '0');
  const today = () => { const now = new Date(); return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`; };
  const shortDate = value => `${Number(value.slice(5, 7))}月${Number(value.slice(8, 10))}日`;
  const statusOf = policy => (!policy.applicationEnd ? 'notice' : policy.applicationEnd < today() ? 'closed' : 'open');
  const daysLeft = policy => Math.round((Date.parse(policy.applicationEnd) - Date.parse(today())) / 86400000);

  function windowText(policy) {
    const status = statusOf(policy);
    if (status === 'notice') return '暂无统一申报窗口';
    if (status === 'closed') return `已于${shortDate(policy.applicationEnd)}截止`;
    if (policy.applicationStart > today()) return `${shortDate(policy.applicationStart)}开始申报`;
    const left = daysLeft(policy);
    return `${shortDate(policy.applicationEnd)}截止${left <= 7 ? `，${left ? `还剩 ${left} 天` : '今天截止'}` : ''}`;
  }

  /* 匹配依据只来自用户所选内容，不声称企业已满足政策条件。 */
  function matchPolicies(answers) {
    const { region, industry, stage, revenue, rd, talent } = answers;
    const rdLow = rd === '2%以下' || rd === '2%-3%';
    const inRegion = policy => !region || policy.region === '全国' || policy.region === region;
    const inIndustry = policy => !industry || industry === '其他行业' || policy.industries.includes(industry);
    const reasonsFor = policy => {
      const rules = [
        region && policy.region === region && [3, `面向${region}，和你选的地区一致`],
        region && policy.region === '全国' && [1, '全国范围的政策'],
        industry && policy.industries.includes(industry) && [2, `${industry}在这项政策涉及的行业内`],
      ];
      if (policy.supportType === '研发支持') rules.push(
        rd && !rdLow && [2, `研发费占比 ${rd}，和研发支持方向相符`],
        rd && rdLow && [0, `研发费占比 ${rd}，研发投入要重点核对`],
        talent === '有' && [1, '近3年引进过人才，可作为研发能力的佐证'],
      );
      if (policy.supportType === '资质培育') rules.push(
        stage && !stage.startsWith('成熟') && [1, `处于${stage.slice(0, 3)}，可以核对培育条件`],
        rd && !rdLow && [1, `研发费占比 ${rd}，可作为资质材料的基础`],
      );
      if (policy.supportType === '数字化改造') rules.push(
        revenue && revenue !== '500万以下' && [1, `营业收入 ${revenue}，有条件开展数字化项目`],
      );
      if (policy.supportType === '金融支持') rules.push(
        stage && [1, `处于${stage.slice(0, 3)}，可以了解对应的金融服务`],
      );
      return rules.filter(Boolean);
    };
    const order = { open: 0, notice: 1, closed: 2 };
    return publicPolicies()
      .filter(policy => inRegion(policy) && inIndustry(policy))
      .map((policy, index) => {
        const matched = reasonsFor(policy);
        return { policy, index, status: statusOf(policy), score: matched.reduce((sum, [points]) => sum + points, 0), reasons: matched.map(([, reason]) => reason) };
      })
      .sort((a, b) => order[a.status] - order[b.status] || b.score - a.score || a.index - b.index);
  }

  /* ---------- 画像出来前的理解过程：只整理用户已给的信息，没有外部查询 ---------- */
  const understand = { taskId: '', stage: 0, timer: 0 };
  const understanding = taskId => understand.taskId === taskId;

  function understandStages(task) {
    const answers = answersOf(task), files = filesOf(task).length;
    const row = (label, value) => `<div class="match-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
    const stages = [
      { title: '读取企业名称', rows: row('企业名称', task.company.name) },
      { title: '整理你提供的信息', rows: row('所在地区', answers.region || '未填写') + row('企业资料', files ? `${files} 份` : '未提供') },
      { title: '生成企业画像', rows: row('下一步', '补充几项情况，画像会更完整') },
    ];
    return `<ol class="match-stages" data-understand aria-live="polite">${stages.map((stage, index) => `<li class="match-stage" data-stage="${index}"${index > understand.stage ? ' hidden' : ''} data-state="${index === understand.stage ? 'active' : 'done'}"><div class="match-stage-head"><h4>${esc(stage.title)}</h4><span class="match-stage-status" aria-hidden="true"></span></div><div class="match-stage-rows"><div>${stage.rows}</div></div></li>`).join('')}</ol>`;
  }

  function understandTick() {
    if (understand.stage >= 2) {
      Object.assign(understand, { taskId: '', stage: 0, timer: 0 });
      window.PolicyUI.refresh();
      return;
    }
    understand.stage += 1;
    document.querySelectorAll('[data-understand] .match-stage').forEach(node => {
      const index = Number(node.dataset.stage);
      node.hidden = index > understand.stage;
      node.dataset.state = index === understand.stage ? 'active' : 'done';
    });
    understand.timer = window.setTimeout(understandTick, stageDelay);
  }

  function beginPortrait(taskId) {
    window.clearTimeout(understand.timer);
    if (reducedMotion()) return;
    Object.assign(understand, { taskId, stage: 0, timer: window.setTimeout(understandTick, stageDelay) });
  }

  function portraitLoading(task) {
    return `<section class="context-card workspace-summary is-understanding"><header class="context-card-heading"><h2>企业画像</h2><span>理解中</span></header>${understandStages(task)}</section>`;
  }

  /* ---------- 对话里的资料收集 ---------- */
  const intakeActive = task => Boolean(task?.intake) && task.intake.stage !== 'ready';

  function assistantBubble(text, card = '', role = 'match') {
    const person = window.PolicyPersonas.get(role);
    return `<div class="chat-message-row is-assistant"><span class="chat-message-avatar chat-message-expert-avatar" aria-hidden="true" style="--portrait-x:${person.x}%;--portrait-y:${person.y}%"></span><div class="chat-message-body intake-body"><span class="chat-message-name">${esc(person.name)}</span><p class="chat-message chat-assistant">${esc(text)}</p>${card}</div></div>`;
  }

  function userBubble(text) {
    return `<div class="chat-message-row is-user"><span class="chat-message-avatar chat-message-user-avatar" aria-hidden="true">企</span><div class="chat-message-body"><span class="chat-message-name">企业负责人</span><p class="chat-message chat-user">${esc(text)}</p></div></div>`;
  }

  function questionFields(answers) {
    const revealed = revealedCount(answers);
    return questions.map((question, index) => `<fieldset class="intake-question${index === revealed - 1 && index ? ' is-new' : ''}" data-question="${index}"${index < revealed ? '' : ' hidden'}><legend>${esc(question.label)}</legend><div class="match-options">${question.options.map(option => `<label class="match-option"><input type="radio" name="${question.key}" value="${esc(option)}"${answers[question.key] === option ? ' checked' : ''}><span>${esc(option)}</span></label>`).join('')}</div></fieldset>`).join('');
  }

  function fieldsCard(task) {
    const fields = questionFields(answersOf(task)), answers = answersOf(task);
    return `<div class="intake-card intake-form" data-task="${esc(task.id)}"><div class="intake-name-row"><label for="intake-name">企业名称</label><input id="intake-name" type="text" maxlength="300" autocomplete="organization" data-task="${esc(task.id)}" value="${esc(task.company.name)}"></div>${fields}<div class="intake-foot"><p class="match-hint" aria-live="polite">${esc(hintText(answers))}</p><div class="intake-foot-actions"><button type="button" class="text-button" data-action="intake-start" data-task="${esc(task.id)}">跳过</button><button type="button" class="button button-primary" data-action="intake-start" data-task="${esc(task.id)}">确定 ${icon('arrow')}</button></div></div></div>`;
  }

  /* 输入框里的上传入口和已选文件，资料助理对话的任何阶段都能用。 */
  function composerAttach(task, showList = true) {
    const files = filesOf(task);
    const list = files.length && showList ? `<ul class="intake-files">${files.map(file => `<li><span>${esc(file.name)}</span><small>已上传</small><button type="button" class="text-button" data-action="intake-remove-file" data-task="${esc(task.id)}" data-file="${esc(file.id)}" aria-label="移除${esc(file.name)}">移除</button></li>`).join('')}</ul>` : '';
    return `${list}<label class="intake-attach" for="intake-files" title="上传资料"><input id="intake-files" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" data-task="${esc(task.id)}">${icon('clip')}<span class="sr-only">上传企业资料</span></label>`;
  }

  function answersSummary(answers) {
    return questions.filter(question => answers[question.key]).map(question => answers[question.key]).join(' · ') || '先不填，直接往下';
  }

  function intakeMarkup(task) {
    if (!task?.intake) return '';
    if (understanding(task.id)) return assistantBubble(`收到，我先理解一下「${task.company.name}」的情况。`, `<div class="intake-card match-running"><div class="match-running-body"><div class="match-orb" aria-hidden="true"><span class="match-orb-ring"></span><span class="match-orb-ring"></span><span class="match-orb-core">正在理解</span></div>${understandStages(task)}</div></div>`);
    const answers = answersOf(task), { stage } = task.intake;
    const greeting = `想帮「${task.company.name}」匹配政策，先了解几项情况，点选就行。`;
    if (stage === 'fields') return assistantBubble(greeting, fieldsCard(task));
    const edit = `<button type="button" class="text-button intake-edit" data-action="intake-edit" data-task="${esc(task.id)}">修改</button>`;
    const history = `${assistantBubble(greeting)}${userBubble(answersSummary(answers))}${edit}`;
    const count = filesOf(task).length;
    return `${history}${count ? userBubble(`选了 ${count} 份企业资料`) : ''}${assistantBubble('结果可以随时回看。想补充信息或资料，点上面的修改。', `<div class="intake-foot intake-ready"><button type="button" class="button button-primary" data-task="${esc(task.id)}" data-action="intake-result">查看匹配结果 ${icon('arrow')}</button></div>`)}`;
  }

  /* ---------- 按所选政策生成准备清单 ---------- */
  function applicationPatch(task, policy) {
    const sources = [...task.sources];
    const statusOf_ = sourceId => sources.find(source => source.id === sourceId)?.provided ? 'ready' : 'missing';
    const items = policy?.application?.checklist;
    if (items) {
      const requirements = items.map(item => {
        const id = `${policy.id}-${item.id}`;
        if (item.kind === 'condition') {
          const previous = task.requirements.find(entry => entry.id === id);
          return { id, label: item.label, status: previous?.status === 'ready' ? 'ready' : 'unknown', kind: 'condition', evidence: item.note, sourceId: '', action: '', required: item.required !== false };
        }
        if (!sources.some(source => source.id === id)) sources.push({ id, name: item.label, type: 'document', text: '', provided: false });
        return { id, label: item.label, status: statusOf_(id), kind: 'material', evidence: item.note, sourceId: id, action: '', required: item.required !== false };
      });
      return { sources, requirements };
    }
    // 原文没有列清单：回到常用资料。
    const common = window.PolicyData.createTaskSeed({}).requirements.map(item => ({ ...item, status: statusOf_(item.sourceId) }));
    return { sources, requirements: common };
  }

  function chooseStep(task, policy) {
    const changed = task.policyId !== policy.id;
    return { policyId: policy.id, status: 'processing', ...(changed ? applicationPatch(task, policy) : {}), steps: changed ? { match: true, diagnosis: false, assembly: false, review: false } : { match: true } };
  }

  /* 材料清单先说明政策依据；办理渠道另放办理指引。 */
  function applicationIntro(task) {
    const policy = publicPolicies().find(item => item.id === task.policyId);
    if (!policy) return '';
    const app = policy.application;
    const source = `<a href="${esc(policy.sourceUrl)}" target="_blank" rel="noopener noreferrer">《${esc(policy.title)}》</a>`;
    const downloads = (app?.templates || []).filter(item => /\.(zip|docx?|pdf)(?:[?#]|$)/i.test(item.url));
    return `<div class="chat-gap-templates"><p>${app ? `根据${source}，需要准备以下资料：` : `${source}未列出具体材料清单，以下为常用资料，待按原文核对。`}</p>${downloads.map(item => `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.label)}</a>`).join('')}</div>`;
  }

  function applicationGuidance(policy) {
    const app = policy?.application;
    if (!app) return '';
    return `<div class="chat-gap-templates guidance-policy-note">${app.templateNote ? `<p>${esc(app.templateNote)}</p>` : ''}${(app.templates || []).map(item => `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.label)}</a>`).join('')}</div>`;
  }

  function applicationNote(task, item) {
    return publicPolicies().find(policy => policy.id === task.policyId)?.application?.checklist.find(entry => `${task.policyId}-${entry.id}` === item.id)?.note || '';
  }

  /* ---------- 办理指引：对话里是步骤，点开在右侧抽屉看详情；提交由用户本人完成 ---------- */
  const latestVersion = task => S().getState().versions.filter(version => version.taskId === task.id).sort((a, b) => b.number - a.number)[0];

  function guidanceMarkup(task) {
    const policy = task.steps.match ? window.PolicyData.policies.find(item => item.id === task.policyId && !item.noPolicy) : null;
    if (!policy) return '';
    const open = publicPolicies().find(item => item.id === policy.id);
    const latest = latestVersion(task);
    const submit = open?.application?.submit;
    const deadline = submit?.deadline || (open ? windowText(open) : policy.deadline);
    const scored = open ? policyScore(task, open) : null;
    const rows = [
      { title: '检查申报材料', detail: !latest ? '还没有申报材料' : scored ? `V${latest.number}，匹配评分 ${scored.score} 分，仅供参考` : `V${latest.number}，点开查看全部内容`, attrs: latest ? `data-route="version" data-id="${esc(latest.id)}"` : 'data-route="task"', work: latest ? 'guidance' : 'assembly', state: !latest ? '待整理' : latest.status === 'confirmed' ? '已确认' : '待确认', done: latest?.status === 'confirmed' },
      { title: '到官方系统提交', detail: submit ? `${submit.name}，${deadline}截止` : '按政策指定的官方渠道办理', attrs: 'data-route="guidance"', state: '' },
    ];
    const card = `<ol class="guidance-list">${rows.map((row, index) => `<li><button type="button" class="guidance-step" ${row.attrs} data-task="${esc(task.id)}" data-work="${row.work || 'guidance'}"><span class="guidance-step-number">${index + 1}</span><span class="guidance-step-copy"><strong>${esc(row.title)}</strong><small>${esc(row.detail)}</small></span>${row.state ? `<span class="guidance-step-state${row.done ? ' is-done' : ''}">${esc(row.state)}</span>` : ''}${icon('arrow')}</button></li>`).join('')}</ol>`;
    return assistantBubble(`接下来这样办，点开每一步看详情。`, card + applicationGuidance(open), 'guidance');
  }

  /* 打开材料时按这版内容重新估一次成功率。 */
  function versionReview(task, version) {
    const policy = task?.policyId === version.policyId ? publicPolicies().find(item => item.id === version.policyId) : null;
    const result = policy && policyScore(task, policy);
    if (!result) return '';
    return `<section class="drawer-summary version-review"><div class="score-orb"><strong>${result.score}<small>分</small></strong><span>匹配评分</span></div><div><p>按这版材料重新评估</p><small>已备 ${result.ready}/${result.total} 项必传材料，仅供参考，最终以主管部门审核为准。</small></div></section>`;
  }

  /* 抽屉里的提交详情；没有整理过的政策沿用原来的办理页。 */
  function guidanceDetail(task) {
    const policy = task.steps.match ? publicPolicies().find(item => item.id === task.policyId) : null;
    if (!policy) return '';
    const submit = policy.application?.submit;
    const left = statusOf(policy) === 'open' ? daysLeft(policy) : null;
    const facts = [['截止时间', submit?.deadline || windowText(policy)], ...(left !== null ? [['还剩', `${left} 天`]] : []), ...(submit?.contact ? [['咨询', submit.contact]] : [])];
    const steps = [
      { title: '打开官方系统', detail: submit ? submit.name : '按原文写明的渠道办理', action: `<a class="button button-primary" href="${esc(submit?.url || policy.sourceUrl)}" target="_blank" rel="noopener noreferrer">${submit ? '打开系统' : '查看原文'} ${icon('arrow')}</a>` },
      ...(submit ? submit.steps : []).map(step => ({ title: step })),
      { title: '保存回执', detail: '提交后保存系统的回执，以便后续查询。' },
    ];
    return `<div class="guidance-detail"><h2 class="sr-only">到官方系统提交</h2><section class="drawer-summary guidance-summary"><p>${esc(policy.title)}</p><dl>${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl></section><ol class="guidance-timeline">${steps.map(step => `<li${step.detail ? '' : ' class="is-plain"'}><div><strong>${esc(step.title)}</strong>${step.detail ? `<small>${esc(step.detail)}</small>` : ''}</div>${step.action || ''}</li>`).join('')}</ol><p class="guidance-note">登录和提交要你本人在官方系统完成。</p></div>`;
  }

  /* 公开政策的详情：和政策列表用同一张结构化卡片。 */
  function policyDetail(task, policyId) {
    const policy = publicPolicies().find(item => item.id === policyId);
    if (!policy) return '';
    const matched = matchPolicies(factsOf(task)).find(item => item.policy.id === policyId);
    return `<div class="match-drawer-body-inline">${policyCard(task, { policy, status: statusOf(policy), reasons: matched?.reasons || [] }, false)}</div>`;
  }

  /* ---------- 政策解读：在对话里选政策、看解读 ---------- */
  const factsOf = task => {
    const answers = answersOf(task);
    return { ...answers, region: answers.region || task.company.region, industry: answers.industry || task.company.industry };
  };

  /* 按画像排序；画像对不上任何政策时列出全部，解读不要求企业符合条件。 */
  function interpretMatches(task) {
    const matched = matchPolicies(factsOf(task));
    return matched.length ? matched : matchPolicies({});
  }

  const interpretId = task => task.interpretPolicyId || '';
  const interpretingPublic = task => publicPolicies().find(policy => policy.id === interpretId(task));
  // 选的是内置项目自带的政策时，沿用原来的对话内容。
  const interpretActive = task => !interpretId(task) || Boolean(interpretingPublic(task));

  /* 所有评分展示共用分项结果；这是匹配评分，不是审批概率。 */
  function comparisonRows(task, policy) {
    const { region, industry } = factsOf(task);
    const metrics = policyMetrics(task, policy);
    const items = (policy.application?.checklist || []).filter(item => item.kind !== 'condition' && item.required !== false);
    const ready = items.filter(item => task.sources?.some(source => source.id === `${policy.id}-${item.id}` && source.provided)).length;
    const row = (key, label, required, current, max, ratio, action) => ({key,label,required,current,max,points:ratio===null?null:Math.round(max*Math.min(1,Math.max(0,ratio))),status:ratio===null?'unknown':ratio>=1?'ready':'missing',action});
    const rows = [
      row('region','适用地区',policy.region,region||'待补充',15,policy.region==='全国'?1:!region?null:region===policy.region?1:0,'核对地区'),
      row('industry','所属行业',policy.industries.join('、')||'以原文为准',industry||'待补充',15,!industry||industry==='其他行业'||!policy.industries.length?null:policy.industries.includes(industry)?1:0,'核对行业'),
      ...metrics.map((item,index)=>({...row(item.key,item.label,`≥ ${item.need} ${item.unit}`,item.have===null?'待核实':`${item.have} ${item.unit}`,Math.floor(30/metrics.length)+(index===0?30%metrics.length:0),item.have===null?null:item.have/item.need,'核对数量'),metric:item})),
      {...row('materials','申报材料',items.length?`${items.length} 项必需材料`:'清单待核实',`${ready} 项已上传`,metrics.length?40:70,items.length?ready/items.length:null,'补充材料'),ready,total:items.length},
    ];
    return rows;
  }
  function policyScore(task, policy) {
    if (!task?.id) return null;
    const rows=comparisonRows(task,policy),materials=rows.find(row=>row.key==='materials');
    return {score:rows.reduce((sum,row)=>sum+(row.points||0),0),rows,ready:materials.ready,total:materials.total,known:questions.filter(question=>answersOf(task)[question.key]).length,knownTotal:questions.length};
  }

  function scoreBadge(task, policy) {
    const result = policyScore(task, policy);
    return result ? `<span class="policy-score"><strong>${result.score}<small>分</small></strong><small>匹配评分</small></span>` : '';
  }

  function scoreText(task, policy) {
    const result = policy && policyScore(task, policy);
    if (!result) return '告诉我企业名称和情况，我才能计算匹配评分。';
    return `按现在的信息和资料，「${policy.title}」的匹配评分是 ${result.score} 分。已备 ${result.ready}/${result.total} 项资料，企业情况已填 ${result.known}/${result.knownTotal} 项，补充后会更新。这是估算，最终以主管部门审核为准。`;
  }

  function scorePanel(task, policy) {
    const status = statusOf(policy);
    const result = policyScore(task, policy);
    return `<div class="interpret-score"><div class="score-orb${result ? '' : ' is-empty'}">${result ? `<strong>${result.score}<small>分</small></strong>` : '<strong>--</strong>'}<span>匹配评分</span></div><p>${status === 'open' ? '' : status === 'closed' ? '这项政策已截止。' : '这项政策暂无申报窗口。'}${result ? '按现在的信息和资料估算，最终以主管部门审核为准。' : '告诉我企业情况和资料，我来估算。'}</p></div>`;
  }

  /* 政策列表默认只露几条，点“查看全部”在原地展开。 */
  const expandedLists = new Set();
  const isExpanded = task => expandedLists.has(task.id || 'guest');
  const moreButton = (task, total, limit) => total > limit ? `<button type="button" class="match-more-button" data-action="match-expand" data-task="${esc(task.id)}" aria-expanded="${isExpanded(task)}">${isExpanded(task) ? '收起' : `查看全部 ${total} 项政策`}</button>` : '';

  function interpretPicker(task) {
    const matches = interpretMatches(task);
    const hasFacts = factsOf(task).region || factsOf(task).industry;
    // 没有画像时多列一些，并引导补充；有画像时只列最相关的。
    const shown = isExpanded(task) ? matches.length : hasFacts ? 3 : 6;
    const guide = hasFacts ? '' : `<div class="interpret-guide"><p>告诉我企业名称和情况，可以计算匹配评分。</p>${task.id ? `<button type="button" class="text-button" data-action="portrait-edit" data-task="${esc(task.id)}">补充企业信息</button>` : '<button type="button" class="text-button" data-action="home-start-expert" data-work="profile">补充企业信息</button>'}</div>`;
    const cards = matches.slice(0, shown).map(({ policy, status }) => `<article class="match-policy is-compact is-clickable is-${status}">${scoreBadge(task, policy)}<p class="match-policy-tag">${{ open: '正在申报', notice: '政策方向', closed: '已截止' }[status]}</p><h3><button type="button" class="match-policy-open" data-action="match-drawer" data-task="${esc(task.id)}" data-policy="${esc(policy.id)}">${esc(policy.title)}</button></h3><p class="match-policy-meta">${esc(policy.region)} · ${esc(windowText(policy))}</p></article>`).join('');
    const more = moreButton(task, matches.length, hasFacts ? 3 : 6);
    return assistantBubble('想了解哪项政策？选一项，我来讲清楚。', `<div class="intake-card match-result">${guide}${cards}${more}</div>`, 'match');
  }

  /* 模拟数据：等接入政策结构化数据和企业数据库后替换。门槛按政策的支持方向给，不是政策原文；企业数量按名称算，同一企业每次一样。 */
  const mockThresholds = {
    研发支持: [{ key: 'patents', label: '专利', need: 3, unit: '个' }, { key: 'rdStaff', label: '研发人员', need: 10, unit: '人' }],
    资质培育: [{ key: 'patents', label: '专利', need: 1, unit: '个' }, { key: 'copyrights', label: '软件著作权', need: 2, unit: '个' }],
    数字化改造: [{ key: 'copyrights', label: '软件著作权', need: 1, unit: '个' }, { key: 'rdStaff', label: '研发人员', need: 5, unit: '人' }],
    金融支持: [{ key: 'patents', label: '专利', need: 1, unit: '个' }],
  };
  function mockCompanyData(task) {
    const name = task?.company?.name;
    if (!name) return null;
    const hash = [...name].reduce((sum, char) => (sum * 31 + char.codePointAt(0)) % 9973, 7);
    const defaults={patents:hash%4,copyrights:(hash>>2)%5,rdStaff:4+(hash>>3)%15};
    const answers=answersOf(task);
    return Object.fromEntries(Object.entries(defaults).map(([key,value])=>{
      const field=`metric_${key}`;
      if(!Object.hasOwn(answers,field))return [key,value];
      const n=Number(answers[field]);
      return [key,answers[field]!==''&&Number.isInteger(n)&&n>=0&&n<=1000000?n:null];
    }));
  }
  const companyRows = task => {
    const data = mockCompanyData(task);
    return data ? [['专利数量', data.patents===null?'待核实':`${data.patents} 个`], ['软件著作权', data.copyrights===null?'待核实':`${data.copyrights} 个`], ['研发人员', data.rdStaff===null?'待核实':`${data.rdStaff} 人`]] : [];
  };
  function policyMetrics(task, policy) {
    const data = mockCompanyData(task);
    return (mockThresholds[policy.supportType] || []).map(rule => ({ ...rule, have: data ? data[rule.key] : null, met: data && data[rule.key]!==null ? data[rule.key] >= rule.need : false }));
  }

  const metricUnit = unit => unit === '人' ? '名' : unit;
  const metricLine = ({ label, need, unit, have }) => `政策需要 ${need} ${metricUnit(unit)}${label}，您目前有 ${have} ${metricUnit(unit)}`;

  /* 单条政策的结构化对照：企业有什么、还缺什么。只用已知信息，不推断企业满足条件。 */
  function policyGap(task, policy) {
    const have = [], lack = [];
    const { region, industry } = factsOf(task), answers = answersOf(task);
    if (policy.region === '全国') have.push('全国范围的政策，地区不受限');
    else if (region) (region === policy.region ? have : lack).push(region === policy.region ? `企业在${region}，符合政策地区` : `政策面向${policy.region}，企业在${region}`);
    if (industry && industry !== '其他行业') (policy.industries.includes(industry) ? have : lack).push(policy.industries.includes(industry) ? `${industry}在政策涉及的行业内` : `政策涉及的行业里没有${industry}`);
    questions.forEach(question => { if (answers[question.key]) have.push(`${question.label}：${answers[question.key]}`); });
    const files = filesOf(task).length;
    if (files) have.push(`已上传 ${files} 份文件，待核对`);
    policyMetrics(task, policy).forEach(metric => {
      const { label, need, unit, have: count, met } = metric;
      if (count === null) lack.push(`政策需要 ${need} ${metricUnit(unit)}${label}`);
      else if (met) have.push(metricLine(metric));
      else {
        if (count > 0) have.push(`${label} ${count} ${unit}`);
        lack.push(`${metricLine(metric)}，还差 ${need - count} ${metricUnit(unit)}`);
      }
    });
    const items = policy.application?.checklist;
    if (items) {
      items.forEach(item => {
        const id = `${policy.id}-${item.id}`;
        const note = item.note ? `（${item.note}）` : '';
        if (item.kind === 'condition') {
          if (task.requirements?.some(entry => entry.id === id && entry.status === 'ready')) have.push(`已核对：${item.label}`);
          else lack.push(`待确认：${item.label}${note}`);
        } else if (task.sources?.some(source => source.id === id && source.provided)) have.push(`已有：${item.label}`);
        else if (item.required !== false) lack.push(`${item.label}${note}`);
      });
    } else {
      policy.conditions.forEach(condition => lack.push(`待确认：${condition}`));
      policy.materials.forEach(material => lack.push(`需要准备：${material}`));
      if (!policy.conditions.length && !policy.materials.length) lack.push('原文没有列出具体要求，以原文为准');
    }
    return { have, lack };
  }

  const serviceOptions = {
    patents:[['search','专利检索评估','先查技术方向与已有专利，明确值得准备的申请内容。',['技术方案与创新点','已有专利及检索记录','计划应用的产品或项目']],['file','专利申请辅导','梳理技术交底与申请资料，逐项确认需要补充的内容。',['技术交底书','研发过程与成果证明','申请主体与发明人信息']]],
    copyrights:[['book','软件著作权资料梳理','核对软件说明和代码资料，整理登记准备清单。',['软件功能说明','代码资料','权属与开发记录']],['file','知识产权材料核对','对照企业已有成果，检查证明材料是否完整。',['已有登记证书','权属证明','成果与项目对应关系']]],
    materials:[['file','申报材料整理','按本项政策清单归集文件，标出尚待补充的内容。',['企业基本资料','政策要求的附件','签字盖章材料']],['check','提交前材料核对','检查正文、附件和版本，形成提交前核对清单。',['拟提交的材料版本','附件与签章','提交时间与办理渠道']]],
  };
  function recommendationMarkup(task,policy,rows) {
    if(!task.id)return '';
    const metric=rows.find(row=>row.metric && row.metric.have!==null && row.metric.have<row.metric.need && ['patents','copyrights'].includes(row.key));
    const materials=rows.find(row=>row.key==='materials');
    const kind=metric?.key || (materials.total>materials.ready?'materials':'');
    if(!kind)return '';
    const title=metric?`还差 ${metric.metric.need-metric.metric.have} ${metric.key==='patents'?'项专利':'项软件著作权'}，看看如何补齐`:`还有 ${materials.total-materials.ready} 项材料待准备`;
    return `<section class="interpret-services" aria-labelledby="interpret-services-title"><div class="interpret-section-heading"><span>03</span><div><h3 id="interpret-services-title">${esc(title)}</h3><p>针对当前缺口，了解可获得的服务支持。</p></div></div><div class="interpret-service-grid">${serviceOptions[kind].map(([symbol,title,description,needs],i)=>`<article class="interpret-service-card"><div class="interpret-service-cover tone-${i}" aria-hidden="true"><span class="service-paper">${icon(symbol)}<i></i><i></i></span><span class="service-cover-label">${i?'资料准备':'梳理与核对'}</span></div><div class="interpret-service-copy"><h4>${title}</h4><p>${description}</p><details><summary>查看服务 ${icon('arrow')}</summary><div class="service-details"><strong>咨询前可准备</strong><ul>${needs.map(need=>`<li>${need}</li>`).join('')}</ul><p>服务内容与交付范围需进一步沟通确认。</p></div></details></div></article>`).join('')}</div></section>`;
  }
  function interpretFooter(task,policy) {
    const status=statusOf(policy),chosen=task.steps.match&&task.policyId===policy.id;
    return `<footer class="interpret-footer"><div><span>下一步</span><strong>${status==='closed'?'本期申报已截止':'整理本项政策的申报材料'}</strong></div>${status==='open'||chosen?`<button type="button" class="button button-primary" data-action="interpret-apply" data-task="${esc(task.id)}" data-policy="${esc(policy.id)}">${chosen?'去准备材料':'申报这项政策'} ${icon('arrow')}</button>`:`<a class="text-button" href="${esc(policy.sourceUrl)}" target="_blank" rel="noopener noreferrer">查看政策原文 ${icon('arrow')}</a>`}</footer>`;
  }
  function interpretCard(task, policy) {
    const result=policyScore(task,policy),rows=result?.rows||comparisonRows(task,policy),materials=rows.find(row=>row.key==='materials');
    const pending=rows.filter(row=>row.status!=='ready').length;
    const facts=[['支持方向',policy.supportType],['适用地区',policy.region],['申报时间',windowText(policy)],['发布部门',policy.agency]];
    const labels={ready:'已满足',missing:'待补充',unknown:'待核实'};
    return `<div class="policy-review"><section class="interpret-overview"><div class="interpret-eyebrow">01 / 了解政策</div><h3><a class="interpret-title" href="${esc(policy.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(policy.title)} ${icon('arrow')}</a></h3><p class="interpret-summary">${esc(policy.summary)}</p><div class="interpret-summary-grid"><dl class="interpret-facts">${facts.map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><div class="interpret-score-result"><span>匹配评分</span><strong data-total-score="${result?.score??''}">${result?.score??'—'}<small>/ 100</small></strong><div><b>${pending}</b> 项待补充或核实</div><small>按下方分项相加，未核实项暂不计分</small></div></div></section><section class="interpret-comparison" aria-labelledby="comparison-title"><div class="interpret-section-heading"><span>02</span><div><h3 id="comparison-title">逐项对照，看看还差什么</h3><p>核对企业现状，再准备对应资料。</p></div></div><div class="interpret-table-scroll" tabindex="0" role="region" aria-label="政策条件对照表"><table class="interpret-table"><thead><tr><th scope="col">对照维度</th><th scope="col">政策要求</th><th scope="col">企业现状</th><th scope="col">得分 / 满分</th><th scope="col">待办</th></tr></thead><tbody>${rows.map(row=>`<tr data-dimension="${row.key}" data-state="${row.status}"><th scope="row">${row.label}</th><td>${esc(row.required)}${row.metric?'<small class="interpret-rule-note">数量口径待原文核实</small>':''}</td><td>${esc(row.current)}<span class="comparison-state is-${row.status}">${row.key==='materials'&&row.status==='ready'?'已上传':labels[row.status]}</span></td><td class="comparison-points" data-points="${row.points??''}" data-max="${row.max}"><b>${row.points??'—'}</b><span> / ${row.max}</span></td><td><button type="button" class="text-button" data-action="interpret-todo" data-task="${esc(task.id)}" data-policy="${esc(policy.id)}" data-key="${row.key}">${row.status==='ready'&&row.key==='materials'?'查看材料':row.action}</button></td></tr>`).join('')}</tbody></table></div><div id="interpret-supplement" aria-live="polite"></div>${policy.applicationTimeNote?`<p class="interpret-time-note">${esc(policy.applicationTimeNote)}</p>`:''}</section>${recommendationMarkup(task,policy,rows)}</div>`;
  }

  function updateInterpretDrawer(task,policy) {
    const drawer=document.querySelector('#match-drawer');if(!drawer)return;
    drawer.querySelector('.match-drawer-body').innerHTML=interpretCard(task,policy);
    drawer.querySelector('.interpret-footer').outerHTML=interpretFooter(task,policy);
  }
  function supplementMarkup(task,policy,key) {
    const row=comparisonRows(task,policy).find(row=>row.key===key);if(!row)return '';
    if(key==='materials') {
      const items=(policy.application?.checklist||[]).filter(item=>item.kind!=='condition'&&item.required!==false);
      return `<div class="interpret-supplement-card"><h4>本项政策的材料清单</h4><ul>${items.map(item=>`<li>${task.sources.some(source=>source.id===`${policy.id}-${item.id}`&&source.provided)?'已上传':'待准备'} · ${esc(item.label)}</li>`).join('')||'<li>请先核对原文中的材料要求。</li>'}</ul><button type="button" class="button button-primary" data-action="interpret-apply" data-task="${esc(task.id)}" data-policy="${esc(policy.id)}">${task.policyId===policy.id?'去上传材料':'选定这项政策，上传材料'} ${icon('arrow')}</button></div>`;
    }
    const value=row.metric?row.metric.have:factsOf(task)[key];
    return `<div class="interpret-supplement-card"><label for="interpret-field">核对企业${esc(row.label)}</label><div class="interpret-edit-line"><input id="interpret-field" ${row.metric?'type="number" min="0" max="1000000" step="1"':'type="text" maxlength="100"'} value="${esc(value??'')}" placeholder="${row.metric?'填写已有数量':'填写企业实际信息'}"><button type="button" class="button button-primary" data-action="interpret-save" data-key="${key}" data-task="${esc(task.id)}" data-policy="${esc(policy.id)}">保存并更新评分</button></div><small>填写已有情况，未知可留空，相关结论将重新核对。</small></div>`;
  }

  function interpretMarkup(task) {
    if (!task || !interpretActive(task)) return '';
    return interpretPicker(task);
  }

  const interpretPicking = task => Boolean(task) && !interpretId(task);

  /* ---------- 只想了解政策：不填企业名称、不建项目 ---------- */
  const guest = { policyId: '', messages: [], applying: false };
  const guestTask = () => ({ id: '', company: { name: '', region: '', industry: '' }, steps: {}, interpretPolicyId: guest.policyId, requirements: [], sources: [] });

  function guestMarkup() {
    const row = message => message.role === 'user' ? userBubble(message.text) : assistantBubble(message.text, '', 'match');
    const form = guest.applying ? assistantBubble('告诉我企业名称，我接着帮你查还差什么。', `<form id="company-start-form" class="intake-card home-start-card" data-work="diagnosis" data-apply-policy="${esc(guest.policyId)}"><div class="intake-name-row"><label for="start-company-name">企业名称</label><input id="start-company-name" name="companyName" type="text" maxlength="300" required autocomplete="organization" placeholder="请输入企业全称"></div><div class="intake-foot is-end"><button type="submit" class="button button-primary">继续 ${icon('arrow')}</button></div></form>`, 'match') : '';
    return `${interpretMarkup(guestTask())}${guest.messages.map(row).join('')}${form}`;
  }

  function guestAsk(text) {
    guest.messages.push({ role: 'user', text, workId: 'match' }, { role: 'assistant', text: window.PolicyChat.answerFor(guestTask(), text, 'match'), workId: 'match' });
  }

  function finishGuest(task, policyId) {
    const policy = publicPolicies().find(item => item.id === policyId);
    if (!policy) return false;
    const saved = S().updateTask(task.id, { ...chooseStep(task, policy), interpretPolicyId: policy.id, messages: guest.messages.map(message => ({ ...message, expertId: 'policy-adviser' })) });
    Object.assign(guest, { policyId: '', messages: [], applying: false });
    return saved;
  }

  function handleGuest(action, target) {
    if (action === 'match-drawer') { openDrawer(guestTask(), target); return; }
    closeDrawer();
    if (action === 'interpret-apply') guest.applying = true;
    window.PolicyUI.refresh();
    if (guest.applying) { const input = document.querySelector('#start-company-name'); input?.scrollIntoView?.({ block: 'nearest' }); input?.focus({ preventScroll: true }); }
  }

  /* ---------- 右栏企业画像就地编辑 ---------- */
  let portraitEditTask = '';
  const portraitEditing = taskId => portraitEditTask === taskId;

  function swapPortrait(task) {
    const box = document.querySelector('.workspace-summary');
    if (box) box.outerHTML = window.PolicyWorkspace.portraitMarkup(task);
  }

  function portraitField(task, question) {
    const answers = answersOf(task);
    const current = question.key === 'region' ? task.company.region || answers.region : question.key === 'industry' ? task.company.industry || answers.industry : answers[question.key];
    const options = [...question.options, ...(current && !question.options.includes(current) ? [current] : [])];
    return `<select id="portrait-${question.key}" data-portrait-field="${question.key}"><option value="">待补充</option>${options.map(option => `<option value="${esc(option)}"${option === current ? ' selected' : ''}>${esc(option)}</option>`).join('')}</select>`;
  }

  function portraitEditor(task) {
    const rows = questions.map(question => `<div><label for="portrait-${question.key}">${esc(question.label)}</label>${portraitField(task, question)}</div>`).join('');
    return `<div class="workspace-portrait is-editing"><div><label for="portrait-name">企业名称</label><input id="portrait-name" type="text" maxlength="300" autocomplete="organization" value="${esc(task.company.name)}"></div>${rows}</div><div class="workspace-portrait-actions"><button type="button" class="text-button" data-action="portrait-cancel" data-task="${esc(task.id)}">取消</button><button type="button" class="button button-primary" data-action="portrait-save" data-task="${esc(task.id)}">保存</button></div>`;
  }

  function savePortrait(task) {
    const box = document.querySelector('.workspace-summary');
    const name = box.querySelector('#portrait-name').value.trim();
    if (!name) { window.PolicyUI.toast('企业名称不能为空。'); return; }
    const answers = {...answersOf(task)};
    box.querySelectorAll('[data-portrait-field]').forEach(field => { answers[field.dataset.portraitField] = field.value; });
    // 补上空项不影响已选政策；改了已有的企业事实，后面的结果要重新确认。
    const changed = name !== task.company.name;
    const title = task.title === `${task.company.name} · 政策申报` ? `${name} · 政策申报` : task.title;
    const intake = { ...(task.intake || { stage: 'ready', files: [] }), answers };
    if (!S().updateTask(task.id, { title, intake, company: { name }, ...(changed ? { steps: { ...resetSteps, profile: false } } : {}) })) { window.PolicyUI.toast('未能保存，请重试。'); return; }
    S().confirmWork(task.id, 'profile');
    portraitEditTask = '';
    window.PolicyUI.refresh();
    window.PolicyUI.toast(changed && task.steps.match ? '已保存，企业信息有变化，请重新确认政策。' : '已保存。');
  }

  /* 上传资料回显时打码：只改显示，存的原文和下载的 Word 不变。 */
  const maskSpan = '<span class="masked" role="img" aria-label="已打码">••••</span>';
  function maskedHtml(text) {
    return esc(text)
      .replace(/(?<!\d)(\d{6})(?:19|20)\d{9}([\dXx])(?!\d)/g, `$1${maskSpan}$2`)
      .replace(/(?<!\d)(1[3-9]\d)\d{4}(\d{4})(?!\d)/g, `$1${maskSpan}$2`)
      .replace(/(?<!\d)(\d{4})\d{8,11}(\d{4})(?!\d)/g, `$1${maskSpan}$2`)
      .replace(/(法定代表人|法人代表|联系人|负责人)([:：]\s*)([一-龥])[一-龥]{1,3}/g, `$1$2$3${maskSpan}`);
  }

  /* ---------- 材料解析：原文、缺什么、怎么补、润色。规则检查，只对照政策写明的要点 ---------- */
  const wordFixes = [[/我们公司|我司|我们/g, '本企业'], [/(非常|特别|十分)/g, ''], [/很多/g, '多项'], [/搞(?=[一-龥])/g, '开展'], [/弄好/g, '完成'], [/,/g, '，'], [/;/g, '；'], [/(^|[^0-9]):/g, '$1：'], [/[ \t]+/g, ' ']];

  function reviewMaterial(task, source) {
    const policy = publicPolicies().find(item => item.id === task.policyId);
    const item = policy?.application?.checklist.find(entry => `${policy.id}-${entry.id}` === source.id);
    const unreadable = !source.text.trim() || /^【已上传文件：/.test(source.text);
    if (unreadable) return { unreadable: true, original: '', missing: [], advice: [], polished: '', note: item?.note || '' };
    const text = source.text;
    const missing = (item?.expects || []).filter(word => !text.includes(word));
    const advice = [];
    missing.forEach(word => advice.push(`补充“${word}”：政策要求写明，原文没有提到。`));
    if (text.length < 60) advice.push('内容偏短，建议写清具体做法和结果。');
    if (!/\d/.test(text)) advice.push('没有数字，建议补充金额、人数或时间，方便审核核实。');
    if (/【虚构|示例内容/.test(text)) advice.push('这是示例内容，提交前要换成真实资料。');
    const polished = wordFixes.reduce((value, [from, to]) => value.replace(from, to), text).trim();
    return { unreadable: false, original: text, missing, advice, polished, changed: polished !== text.trim(), note: item?.note || '' };
  }

  function openMaterialReview(task, opener) {
    closeDrawer();
    const source = task.sources.find(item => item.id === opener.dataset.source);
    if (!source) return;
    const review = reviewMaterial(task, source);
    const list = items => `<ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
    const body = review.unreadable
      ? `<section class="review-block"><h3>原文</h3>${uploadThumb(task, source)}<p>这份文件读不到文字。上传 Word（.docx）或文本文件后，才能解析和润色。</p></section>${review.note ? `<section class="review-block"><h3>政策要求</h3><p>${esc(review.note)}</p></section>` : ''}`
      : `<section class="review-block"><h3>原文</h3><div class="review-text">${maskedHtml(review.original)}</div><p class="review-note">敏感信息已打码显示，下载的 Word 保留原文。</p></section><section class="review-block is-lack"><h3>缺什么，怎么补</h3>${review.advice.length ? list(review.advice) : '<p>没有发现明显缺口，提交前再对照政策原文。</p>'}</section><section class="review-block is-polish"><h3>润色</h3><div class="review-text">${maskedHtml(review.polished)}</div>${review.changed ? '' : '<p class="review-note">表达已经比较规范，重点补上面缺的内容。</p>'}</section>`;
    const drawer = document.createElement('div');
    drawer.id = 'match-drawer';
    drawer.className = 'match-drawer';
    drawer.innerHTML = `<button type="button" class="match-drawer-scrim" data-action="match-drawer-close" aria-label="关闭" tabindex="-1"></button><section class="match-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="match-drawer-title"><header><h2 id="match-drawer-title">${esc(source.name)}</h2><button type="button" class="icon-button match-drawer-close" data-action="match-drawer-close" aria-label="关闭" title="关闭">${icon('close')}</button></header><div class="match-drawer-body" tabindex="0">${body}<p class="review-note">改好后下载 Word 修改，再上传回来。</p></div></section>`;
    document.body.append(drawer);
    state.drawerReturn = opener;
    drawer.querySelector('.match-drawer-close').focus({ preventScroll: true });
  }

  /* ---------- 上传图片时打码展示：缩到很小再放大，页面上不留清晰原图；只存在当前页面 ---------- */
  const mosaics = new Map();
  const mosaicWidth = 24;

  function rememberUpload(file, taskId = '', work = '', sourceId = '') {
    if (!/^image\//.test(file?.type || '') || typeof URL.createObjectURL !== 'function') return;
    const url = URL.createObjectURL(file), image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = mosaicWidth;
      canvas.height = Math.max(1, Math.round(mosaicWidth * image.naturalHeight / image.naturalWidth));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const list = mosaics.get(taskId) || [];
      mosaics.set(taskId, [...list, { name: file.name, work, sourceId, url: canvas.toDataURL('image/png') }]);
      URL.revokeObjectURL(url);
      window.PolicyUI.refresh();
    };
    image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;
  }

  // 首页还没建项目时上传的图片，建项目后归到这个项目。
  function adoptUploads(taskId) {
    const pending = mosaics.get('');
    if (pending) { mosaics.set(taskId, pending); mosaics.delete(''); }
  }

  function uploadThumb(task, source) {
    const item = (mosaics.get(task.id) || []).filter(entry => entry.sourceId === source.id).at(-1);
    return item ? `<figure class="chat-upload-mosaic"><img src="${esc(item.url)}" alt="${esc(item.name)}，已打码"><figcaption>${esc(item.name)} · 已打码</figcaption></figure>` : '';
  }

  function uploadsMarkup(task, work) {
    const items = (mosaics.get(task?.id || '') || []).filter(item => !item.work || item.work === work);
    return items.map(item => `<div class="chat-message-row is-user"><span class="chat-message-avatar chat-message-user-avatar" aria-hidden="true">企</span><div class="chat-message-body"><figure class="chat-upload-mosaic"><img src="${esc(item.url)}" alt="${esc(item.name)}，已打码"><figcaption>${esc(item.name)} · 已打码</figcaption></figure></div></div>`).join('');
  }

  /* ---------- 首页：填完名称原地展开，确定或跳过后才建项目 ---------- */
  const homeIntake = { open: false, answers: {} };
  const openHomeIntake = () => { homeIntake.open = true; };

  function homeIntakeMarkup() {
    if (!homeIntake.open) return '';
    return `<div class="start-intake" data-home-intake>${questionFields(homeIntake.answers)}<div class="intake-foot"><p class="match-hint" aria-live="polite">${esc(hintText(homeIntake.answers))}</p><div class="intake-foot-actions"><button type="button" class="text-button" data-action="home-intake-finish">跳过</button><button type="button" class="button button-primary" data-action="home-intake-finish">确定 ${icon('arrow')}</button></div></div></div>`;
  }

  function finishHomeIntake() {
    const input = document.querySelector('#start-company-name');
    const name = input?.value.trim();
    if (!name) { window.PolicyUI.toast('请填写企业名称。'); input?.focus(); return; }
    const task = S().createTask({ title: `${name} · 政策申报`, request: `为${name}查找适用政策并准备申报材料。`, company: { name, region: '', industry: '' }, intake: { stage: 'fields', answers: { ...homeIntake.answers }, files: [] } });
    if (!task) { window.PolicyUI.toast('未能创建，请重试。'); return; }
    Object.assign(homeIntake, { open: false, answers: {} });
    window.PolicyUI.clearCompanyDraft();
    startMatch(task);
  }

  function revealNext(form, answers) {
    const revealed = revealedCount(answers);
    const next = [...form.querySelectorAll('.intake-question')].find((node, index) => index < revealed && node.hidden);
    if (next) {
      next.hidden = false;
      next.classList.add('is-new');
      next.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
    form.querySelector('.match-hint').textContent = hintText(answers);
  }

  /* ---------- 解析动画 ---------- */
  function stageRows(group, answers) {
    return group.keys.map(key => `<div class="match-row"><span>${esc(labelOf(key))}</span><strong>${esc(answers[key] || '未填写')}</strong></div>`).join('');
  }

  function runningMarkup(task) {
    const answers = answersOf(task), files = filesOf(task).length;
    const stages = [...groups.map(group => ({ title: group.title, rows: stageRows(group, answers) })), { title: '比对政策库', rows: `<div class="match-row"><span>比对范围</span><strong>已收录公开政策 ${publicPolicies().length} 项</strong></div><div class="match-row"><span>企业资料</span><strong>${files ? `${files} 份` : '未提供'}</strong></div>` }];
    const card = `<div class="intake-card match-running"><div class="match-running-body"><div class="match-orb" aria-hidden="true"><span class="match-orb-ring"></span><span class="match-orb-ring"></span><span class="match-orb-core" data-orb-label>${state.stage ? '正在匹配中' : '开始匹配'}</span></div><ol class="match-stages" aria-live="polite">${stages.map((stage, index) => `<li class="match-stage" data-stage="${index}"${index > state.stage ? ' hidden' : ''}${index === state.stage ? ' data-state="active"' : ' data-state="done"'}><div class="match-stage-head"><h4>${esc(stage.title)}</h4><span class="match-stage-status" aria-hidden="true"></span></div><div class="match-stage-rows"><div>${stage.rows}</div></div></li>`).join('')}</ol></div></div>`;
    return assistantBubble(`我来帮「${task.company.name}」比对政策。`, card, 'match');
  }

  function summaryGroups(task) {
    const answers = answersOf(task), files = filesOf(task);
    return groups.map(group => {
      const complete = group.keys.every(key => answers[key]);
      return `<details class="match-summary-group"><summary><span>${esc(group.title)}</span><span class="match-summary-state${complete ? '' : ' is-missing'}">${complete ? '已解析' : '待补充'}</span></summary><div class="match-summary-rows">${stageRows(group, answers)}</div></details>`;
    }).join('') + `<details class="match-summary-group"><summary><span>企业资料</span><span class="match-summary-state${files.length ? '' : ' is-missing'}">${files.length ? `${files.length} 份` : '待补充'}</span></summary><div class="match-summary-rows"><div class="match-row"><span>${files.length ? '已上传' : '上传后能匹配更多政策'}</span></div></div></details>`;
  }

  /* 抽屉里的政策卡：把原文里能确定的信息结构化，没有的不补。 */
  function policyCard(task, { policy, status, reasons }, first) {
    const checks = [...policy.conditions, ...(policy.applicationTimeNote ? [policy.applicationTimeNote] : [])];
    const tag = first ? '首选推荐' : { open: '正在申报', notice: '政策方向', closed: '已截止' }[status];
    const chosen = task.steps.match && task.policyId === policy.id;
    const keywords = [policy.supportType, policy.category, ...policy.industries.slice(0, 3)].filter(Boolean);
    const facts = [['支持方向', policy.supportType], ['适用地区', policy.region], ['申报时间', windowText(policy)], ['发布日期', policy.publishedAt]];
    const left = status === 'open' && policy.applicationStart <= today() || status === 'open' && !policy.applicationStart ? daysLeft(policy) : null;
    const scored = policyScore(task, policy);
    const side = scored ? `<span>匹配评分</span><strong>${scored.score}<small> 分</small></strong>` : left !== null ? `<span>距离截止</span><strong>${left}<small> 天</small></strong>` : `<span>申报状态</span><strong class="is-text">${{ open: '未开始', notice: '暂无窗口', closed: '已截止' }[status]}</strong>`;
    const list = (title, items) => items.length ? `<div><h4>${title}</h4><ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div>` : '';
    return `<article class="match-policy is-full is-${status}${first ? ' is-first' : ''}"><div class="match-policy-main"><p class="match-policy-tag">${tag}</p><h3>${esc(policy.title)}</h3><p class="match-policy-keywords">${keywords.map(esc).join(' / ')}</p><p class="match-policy-summary">${esc(policy.summary)}</p><dl class="match-policy-facts">${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl></div><div class="match-policy-side">${side}${status === 'open' ? `<button type="button" class="button ${first ? 'button-primary' : 'button-secondary'}" data-action="match-apply" data-task="${esc(task.id)}" data-policy="${esc(policy.id)}">${chosen ? '已选这项政策' : '申报这项政策'} ${icon('arrow')}</button>` : ''}<a class="match-policy-source" href="${esc(policy.sourceUrl)}" target="_blank" rel="noopener noreferrer">查看政策原文</a></div><div class="match-policy-columns">${list('推荐理由', reasons.length ? reasons : ['补充企业信息后，理由会更具体'])}${list('申报条件', checks)}${list('所需材料', policy.materials)}</div><p class="match-policy-agency"><span>发布部门</span>${esc(policy.agency)}</p></article>`;
  }

  function compactCard(task, { policy, status, reasons }, first) {
    const tag = first ? '首选推荐' : { open: '正在申报', notice: '政策方向', closed: '已截止' }[status];
    const chosen = task.steps.match && task.policyId === policy.id;
    const metric = policyMetrics(task, policy).find(item => item.have !== null && !item.met);
    const reason = reasons.slice(0, 2).join('；') || (metric ? metricLine(metric) : '还没有可判断的信息，补充后结果更准');
    const scored = policyScore(task, policy) ? ' has-score' : '';
    const apply = status === 'open' && !chosen ? `<div class="match-policy-actions"><button type="button" class="button ${first ? 'button-primary' : 'button-secondary'}" data-action="match-apply" data-task="${esc(task.id)}" data-policy="${esc(policy.id)}">申报这项政策 ${icon('arrow')}</button></div>` : '';
    return `<article class="match-policy is-compact is-clickable is-${status}${first ? ' is-first' : ''}${chosen ? ' is-chosen' : ''}${scored}">${chosen ? `<span class="match-policy-check" role="img" aria-label="已选这项政策">${icon('check')}</span>` : ''}${scoreBadge(task, policy)}<p class="match-policy-tag">${tag}</p><h3><button type="button" class="match-policy-open" data-action="match-drawer" data-task="${esc(task.id)}" data-policy="${esc(policy.id)}">${esc(policy.title)}</button></h3><p class="match-policy-meta">${esc(policy.region)} · ${esc(windowText(policy))}</p><p class="match-policy-reason">${esc(reason)}</p>${apply}</article>`;
  }

  function resultMarkup(task) {
    const matches = matchPolicies(factsOf(task));
    const openCount = matches.filter(item => item.status === 'open').length;
    const cards = matches.slice(0, isExpanded(task) ? matches.length : 3).map((item, index) => compactCard(task, item, index === 0 && item.status === 'open')).join('');
    const more = moreButton(task, matches.length, 3);
    const heading = openCount ? `有 ${openCount} 项政策正在申报` : '还没匹配到正在申报的政策';
    const guide = openCount ? '' : `<div class="match-guide"><p>补齐信息或上传资料后，可以再匹配一次。</p><button type="button" class="button button-primary" data-action="match-chat" data-task="${esc(task.id)}">补充企业信息 ${icon('arrow')}</button></div>`;
    const card = `<div class="intake-card match-result"><p id="match-result-heading" class="match-result-heading" tabindex="-1">${heading}</p><p class="match-list-note">范围是已收录的 ${publicPolicies().length} 条官方公开政策，能否申报以原文为准。</p><details class="match-chat-summary"><summary>按这些信息分析</summary>${summaryGroups(task)}</details>${guide}${cards}${more}</div>`;
    return assistantBubble(`「${task.company.name}」比对完了。`, card, 'match');
  }

  /* 全部政策放在右侧抽屉，对话里只留前三项。 */
  function closeDrawer() {
    const drawer = document.querySelector('#match-drawer');
    if (!drawer) return;
    drawer.remove();
    if (state.drawerReturn?.isConnected) state.drawerReturn.focus({ preventScroll: true });
    state.drawerReturn = null;
  }

  function openDrawer(task, opener) {
    closeDrawer();
    const policy = publicPolicies().find(item => item.id === opener.dataset.policy);
    if (!policy) return;
    // 记下正在看的政策，之后在对话里追问就按它回答。
    if (task.id) S().updateTask(task.id, { interpretPolicyId: policy.id });
    else guest.policyId = policy.id;
    const current = task.id ? S().getTask(task.id) : guestTask();
    const drawer = document.createElement('div');
    drawer.id = 'match-drawer';
    drawer.className = 'match-drawer';
    drawer.innerHTML = `<button type="button" class="match-drawer-scrim" data-action="match-drawer-close" aria-label="关闭政策解读" tabindex="-1"></button><section class="match-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="match-drawer-title"><header><h2 id="match-drawer-title">政策解读</h2><button type="button" class="icon-button match-drawer-close" data-action="match-drawer-close" aria-label="关闭" title="关闭">${icon('close')}</button></header><div class="match-drawer-body" tabindex="0">${interpretCard(current, policy)}</div>${interpretFooter(current,policy)}</section>`;
    document.body.append(drawer);
    state.drawerReturn = opener;
    drawer.querySelector('.match-drawer-close').focus({ preventScroll: true });
  }

  /* 企业画像里的可申报数量：匹配过才有。 */
  function openCount(task) {
    if (task?.intake?.stage !== 'ready') return undefined;
    return matchPolicies(factsOf(task)).filter(item => item.status === 'open').length;
  }

  function chatInner(task) {
    return state.taskId === task.id && state.phase === 'running' ? runningMarkup(task) : resultMarkup(task);
  }

  /* 匹配顾问的对话内容。还没收集完时，先交回资料助理。 */
  function matchChatMarkup(task) {
    if (!task?.intake) return '';
    // 企业信息在这里收集，收完接着比对。
    if (task.intake.stage !== 'ready') return intakeMarkup(task);
    return `<div id="match-app" class="match-app">${chatInner(task)}</div>`;
  }

  const matchPending = task => Boolean(task?.intake) && !task.steps.match;

  function followChat() {
    window.PolicyChat.restoreView({ followLatest: true });
  }

  function showResult() {
    state.phase = 'result';
    state.timer = 0;
    if (!document.querySelector('#match-app')) return;
    const settle = () => {
      window.PolicyUI.refresh();
      followChat();
      document.querySelector('#match-result-heading')?.focus({ preventScroll: true });
    };
    if (typeof document.startViewTransition !== 'function' || reducedMotion()) { settle(); return; }
    // 页面不可见时过渡会被跳过，内容仍会更新，不算错误。
    const transition = document.startViewTransition(settle);
    transition.ready.catch(() => {});
    transition.finished.catch(() => {});
  }

  function advance() {
    if (state.stage >= groups.length) { showResult(); return; }
    state.stage += 1;
    const root = document.querySelector('#match-app');
    root?.querySelectorAll('.match-stage').forEach((node, index) => {
      node.hidden = index > state.stage;
      node.dataset.state = index === state.stage ? 'active' : 'done';
    });
    const orb = root?.querySelector('[data-orb-label]');
    if (orb) orb.textContent = '正在匹配中';
    state.timer = window.setTimeout(advance, stageDelay);
  }

  function setIntake(task, patch, extra = {}) {
    return S().updateTask(task.id, { ...extra, intake: { ...task.intake, ...patch } });
  }

  const resetSteps = { match: false, diagnosis: false, assembly: false, review: false };

  function refreshChat() {
    window.PolicyUI.refresh();
    window.PolicyChat.restoreView({ followLatest: true });
  }

  function startMatch(task) {
    const saved = setIntake(task, { stage: 'ready' });
    if (!saved) { window.PolicyUI.toast('资料未能保存，请重试。'); return; }
    S().confirmWork(task.id, 'profile');
    window.clearTimeout(state.timer);
    Object.assign(state, { taskId: task.id, phase: reducedMotion() ? 'result' : 'running', stage: 0, timer: 0 });
    if (state.phase === 'running') state.timer = window.setTimeout(advance, stageDelay);
    window.PolicyUI.navigate('task', { task: task.id, work: 'match' });
  }

  function handleClick(target) {
    const { action } = target.dataset;
    if (!['interpret-todo','interpret-save','match-expand', 'interpret-apply', 'portrait-edit', 'portrait-cancel', 'portrait-save', 'home-intake-finish', 'intake-edit', 'intake-start', 'intake-remove-file', 'intake-result', 'match-chat', 'match-apply', 'match-drawer', 'match-drawer-close'].includes(action)) return false;
    if (action === 'match-drawer-close') { closeDrawer(); return true; }
    if (action === 'home-intake-finish') { finishHomeIntake(); return true; }
    if (action === 'match-expand') {
      const key = target.dataset.task || 'guest';
      if (expandedLists.has(key)) expandedLists.delete(key); else expandedLists.add(key);
      window.PolicyUI.refresh();
      return true;
    }
    if(action==='interpret-todo'||action==='interpret-save') {
      const task=S().getTask(target.dataset.task),policy=publicPolicies().find(item=>item.id===target.dataset.policy);
      if(!task){closeDrawer();window.PolicyUI.navigate('dashboard');window.PolicyUI.toast('先填写企业名称，再补充企业资料。');return true;}
      if(!policy)return true;
      const key=target.dataset.key,row=comparisonRows(task,policy).find(item=>item.key===key);if(!row)return true;
      if(action==='interpret-todo') {
        const panel=document.querySelector('#interpret-supplement');panel.innerHTML=supplementMarkup(task,policy,key);
        panel.scrollIntoView({block:'nearest',behavior:reducedMotion()?'instant':'smooth'});
        panel.querySelector('input,button')?.focus({preventScroll:true});return true;
      }
      const field=document.querySelector('#interpret-field');if(!field||!field.reportValidity())return true;
      const value=field.value.trim();if(row.metric&&value!==''&&(!Number.isInteger(Number(value))||Number(value)<0||Number(value)>1000000)){window.PolicyUI.toast('请填写有效的非负整数。');return true;}
      const answers={...answersOf(task),[row.metric?`metric_${key}`:key]:value};
      const changed=String(row.metric?row.metric.have??'':factsOf(task)[key]||'')!==value;
      const patch={intake:{...(task.intake||{stage:'ready',files:[]}),answers},...(!row.metric?{company:{[key]:value}}:{}),...(changed?{status:'processing',steps:{diagnosis:false,assembly:false,review:false}}:{})};
      if(!S().updateTask(task.id,patch)){window.PolicyUI.toast('未能保存，请重试。');return true;}
      const current=S().getTask(task.id);window.PolicyUI.refresh();updateInterpretDrawer(current,policy);
      document.querySelector(`[data-action="interpret-todo"][data-key="${key}"]`)?.focus({preventScroll:true});
      window.PolicyUI.toast('企业信息与匹配评分已更新。');return true;
    }
    if (!target.dataset.task && ['match-drawer', 'interpret-apply'].includes(action)) { handleGuest(action, target); return true; }
    const task = S().getTask(target.dataset.task);
    if (!task) return true;
    if (action === 'match-drawer') { openDrawer(task, target); return true; }
    if (action === 'interpret-apply') {
      const picked = publicPolicies().find(item => item.id === target.dataset.policy);
      if (!picked || !S().updateTask(task.id, { ...chooseStep(task, picked), interpretPolicyId: picked.id })) { window.PolicyUI.toast('未能保存，请重试。'); return true; }
      closeDrawer();
      window.PolicyUI.navigate('task', { task: task.id, work: 'assembly' });
      return true;
    }
    if (action === 'portrait-edit') { portraitEditTask = task.id; swapPortrait(task); document.querySelector('#portrait-name')?.focus({ preventScroll: true }); return true; }
    if (action === 'portrait-cancel') { portraitEditTask = ''; swapPortrait(task); return true; }
    if (action === 'portrait-save') { savePortrait(task); return true; }
    if (action === 'intake-result') { window.PolicyUI.navigate('task', { task: task.id, work: 'match' }); return true; }
    if (action === 'intake-edit') {
      setIntake(task, task.intake ? { stage: 'fields' } : { stage: 'fields', answers: {}, files: [] });
      refreshChat();
      return true;
    }
    if (action === 'intake-start') { startMatch(task); return true; }
    if (action === 'intake-remove-file') {
      setIntake(task, { files: filesOf(task).filter(file => file.id !== target.dataset.file) });
      refreshChat();
      return true;
    }
    if (action === 'match-chat') {
      closeDrawer();
      setIntake(task, task.intake ? { stage: 'fields' } : { stage: 'fields', answers: {}, files: [] });
      window.PolicyUI.navigate('task', { task: task.id, work: 'match' });
      return true;
    }
    const policy = publicPolicies().find(item => item.id === target.dataset.policy);
    if (!policy) return true;
    closeDrawer();
    if (!S().updateTask(task.id, chooseStep(task, policy))) {
      window.PolicyUI.toast('未能选择这项政策，请重试。');
      return true;
    }
    window.PolicyUI.navigate('task', { task: task.id, work: 'assembly' });
    return true;
  }

  /* 选完一项就露出下一项；只改动相关节点，已选项和键盘焦点都不受影响。 */
  document.addEventListener('change', event => {
    const input = event.target;
    if (input?.id === 'intake-files') {
      const task = S().getTask(input.dataset.task);
      if (!task) return;
      const added = Array.from(input.files || []).map((file, index) => ({ id: `file-${Date.now()}-${index}`, name: file.name, size: file.size }));
      Array.from(input.files || []).forEach(file => rememberUpload(file, task.id, input.closest('#adviser-chat-form')?.dataset.work || ''));
      if (added.length) { S().updateTask(task.id, { intake: { stage: 'ready', answers: {}, ...task.intake, files: [...filesOf(task), ...added].slice(-20) } }); refreshChat(); window.PolicyUI.toast('已上传。'); }
      return;
    }
    if (input?.id === 'intake-name') {
      const task = S().getTask(input.dataset.task), name = input.value.trim();
      if (!task) return;
      if (!name) { input.value = task.company.name; window.PolicyUI.toast('企业名称不能为空。'); return; }
      if (name === task.company.name) return;
      const title = task.title === `${task.company.name} · 政策申报` ? `${name} · 政策申报` : task.title;
      if (!S().updateTask(task.id, { title, company: { name }, steps: resetSteps })) { window.PolicyUI.toast('企业名称未能保存，请重试。'); return; }
      window.PolicyUI.refresh();
      return;
    }
    const home = input?.closest?.('[data-home-intake]');
    if (input?.type === 'radio' && home) {
      homeIntake.answers[input.name] = input.value;
      revealNext(home, homeIntake.answers);
      return;
    }
    const form = input?.closest?.('.intake-form');
    if (input?.type !== 'radio' || !form) return;
    const task = S().getTask(form.dataset.task);
    if (!task) return;
    const answers = { ...answersOf(task), [input.name]: input.value };
    setIntake(task, { answers });
    // 画像跟着选择实时更新，不重绘对话。
    const portrait = document.querySelector('.workspace-summary');
    if (portrait) portrait.outerHTML = window.PolicyWorkspace.portraitMarkup(S().getTask(task.id));
    revealNext(form, answers);
  });

  document.addEventListener('keydown', event => {
    const drawer = document.querySelector('#match-drawer');
    if (!drawer) return;
    if (event.key === 'Escape') { closeDrawer(); return; }
    if (event.key !== 'Tab') return;
    const items = [...drawer.querySelectorAll('.match-drawer-panel button:not([disabled]),.match-drawer-panel a,.match-drawer-panel input,.match-drawer-panel select,.match-drawer-panel summary,.match-drawer-panel [tabindex="0"]')];
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    else if (!drawer.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
  });
  window.addEventListener('hashchange', closeDrawer);

  window.PolicyMatch = Object.freeze({ handleClick, intakeActive, intakeMarkup, matchChatMarkup, matchPending, openCount, composerAttach, questions, understanding, beginPortrait, portraitLoading, portraitEditing, portraitEditor, scoreText, openMaterialReview, reviewMaterial, maskedHtml, companyRows, policyMetrics, openHomeIntake, homeIntakeMarkup, rememberUpload, adoptUploads, uploadsMarkup, interpretMarkup, interpretPicking, guestMarkup, guestAsk, finishGuest, applicationIntro, applicationNote, guidanceMarkup, guidanceDetail, policyDetail, versionReview });
})();
