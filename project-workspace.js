/* 项目工作区：状态由已保存事实推导，不模拟后台并行执行。 */
(() => {
  'use strict';
  const definitions = [
    ['profile','企业资料',window.PolicyPersonas.get('profile').name],
    ['match','政策匹配',window.PolicyPersonas.get('match').name],
    ['diagnosis','差距诊断',window.PolicyPersonas.get('diagnosis').name],
    ['assembly','材料组稿',window.PolicyPersonas.get('assembly').name],
    ['review','人工确认',window.PolicyPersonas.get('review').name],
  ];
  const ranks = {waiting:0,review:0,ready:1,open:2,done:3};
  const S = () => window.PolicyStore;
  const U = () => window.PolicyUI;
  const capabilityDefinitions = [['match','政策解读与匹配','找政策、看缺口'],['assembly','政策申报辅助','备材料、看缺什么、润色'],['guidance','办理指引','提交和办理']];
  const tabHint = id => capabilityDefinitions.find(([key])=>key===id)?.[2] || '';
  const validWork = value => definitions.some(([id]) => id === value) || ['interpret','guidance'].includes(value);
  const versionsFor = task => S().getState().versions.filter(v => v.taskId === task.id).sort((a,b) => b.number-a.number);
  const versionIsCurrent = (task, version) => Boolean(version && version.policyId === task.policyId && version.companyName === task.company.name && version.sections.every(section => section.sourceQuotes.every(quote => {
    const source=task.sources.find(item=>item.id===quote.id);
    return source && source.provided===quote.provided && source.text===quote.text && source.name===quote.name && source.type===quote.type;
  })));

  function workItems(task) {
    const gaps = task.requirements.filter(item => item.status !== 'ready');
    const latest = versionsFor(task)[0];
    const stale = latest && !versionIsCurrent(task,latest);
    const pending = latest && (!latest.sections.length || latest.sections.some(section => !section.body.trim() || /[【\[]待(?:补(?:充)?|核对)[】\]]/.test(section.body)));
    const order = definitions.map(([id]) => id);
    const passed = id => id === 'assembly' ? task.steps.review : id === 'profile' || id === 'diagnosis' || task.steps[id];
    const nextId = order[order.reduce((last,id,index) => passed(id) ? index : last,-1)+1];
    // 员工都能直接找，这里只标已完成、等你处理和建议下一步，不表达“必须先走完前面”。
    const states = {
      profile: task.steps.profile ? ['done','已完成','企业信息已确认。'] : null,
      match: task.steps.match ? ['done','已完成','候选政策与适用条件可查看。'] : null,
      diagnosis: !task.steps.diagnosis ? null : gaps.length ? ['waiting','等你补资料',`诊断已出，${gaps.length} 项资料或条件待处理。`] : ['done','已完成','清单已具备，正文仍需人工核对。'],
      assembly: task.steps.review ? ['done','已完成',latest ? `材料 V${latest.number} 已确认。` : '材料已确认。'] : !latest ? null : stale ? ['waiting','需重新组稿','企业信息或来源已变更，请保存新版本。'] : pending ? ['waiting','草稿待完善','当前版本仍有待补或待核对内容。'] : ['review','待你确认',`确认 V${latest.number} 后就可以去办理。`],
      review: task.steps.review ? ['ready','建议下一步','下载材料，到官方系统提交。'] : null,
    };
    return definitions.map(([id,title,owner]) => {
      const can = window.PolicyPersonas.get(id).can;
      const [status,label,reason] = states[id] || (id === nextId ? ['ready','建议下一步',can] : ['open','',can]);
      return {id,title,owner,can,status,label,reason,rank:ranks[status],done:task.steps[id] === true};
    });
  }
  function selectedWork(task, requested) {
    // 政策解读已并入政策匹配。
    if (requested === 'interpret') return 'match';
    // 差距诊断和材料组稿合成政策申报辅助。
    if (requested === 'diagnosis') return 'assembly';
    if (validWork(requested)) return requested;
    // 企业资料已并入政策匹配。
    if (task.selectedWorkId === 'profile' || task.selectedWorkId === 'interpret') return 'match';
    if (task.selectedWorkId === 'diagnosis') return 'assembly';
    if (validWork(task.selectedWorkId)) return task.selectedWorkId;
    return [...workItems(task)].sort((a,b) => a.rank-b.rank)[0].id;
  }
  const orderedItems = task => workItems(task);
  function leave() {}
  function capabilityItems(task) {
    const base=workItems(task);
    return capabilityDefinitions.map(([id,title]) => {
      const existing=base.find(item=>item.id===id);
      if (existing) return {...existing,title};
      // 办理指引这张卡同时代表提交前核对。
      const review=base.find(item=>item.id==='review');
      if (id==='guidance' && review.status!=='open') return {...review,id,title};
      const persona=window.PolicyPersonas.get(id);
      return {id,title,owner:persona.name,can:persona.can,status:'open',label:'',reason:persona.can,rank:ranks.open,done:false};
    });
  }
  function contentDestination(task, workId) {
    if (workId === 'review') {
      const latest = versionsFor(task)[0];
      return latest ? {route:'version',id:latest.id} : {route:'assembly'};
    }
    return {route:{profile:'profile',match:'policy',interpret:'policy',diagnosis:'diagnosis',assembly:'assembly',guidance:'guidance'}[workId] || 'profile'};
  }
  function documentContent(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const header = template.content.querySelector('.page-header,.mat-header');
    if (header) {
      header.classList.add('workspace-document-heading');
      const title = header.querySelector('h1');
      if (title) { const replacement = document.createElement('h2'); replacement.textContent = title.textContent; title.replaceWith(replacement); }
      header.querySelectorAll('[data-route="task"],[data-route="dashboard"],[data-route="policy"],[data-route="profile"]').forEach(button => button.remove());
    }
    return template.innerHTML;
  }
  /* 右栏上半部分：对话里一步步构建出来的企业画像。 */
  function portraitMarkup(task) {
    if (window.PolicyMatch?.understanding(task.id)) return window.PolicyMatch.portraitLoading(task);
    const E=U().escape,I=U().icon;
    const answers=task.intake?.answers||{};
    // 地区和行业来自企业数据，有才显示。
    const region=task.company.region||answers.region,industry=task.company.industry||answers.industry;
    const rows=[['企业名称',task.company.name],...(region?[['所在地区',region]]:[]),...(industry?[['所属行业',industry]]:[]),...(window.PolicyMatch?.companyRows(task)||[]),...(window.PolicyMatch?.questions||[]).map(question=>[question.label,answers[question.key]])];
    const known=rows.filter(([,value])=>value).length;
    const open=window.PolicyMatch?.openCount(task);
    const sources=[...task.sources].sort((a,b)=>Number(a.provided)-Number(b.provided));
    const sourceHTML=sources.map(source=>`<button type="button" data-action="view-source" data-provided="${source.provided}" data-task="${E(task.id)}" data-id="${E(source.id)}" data-work="${E(task.selectedWorkId||'profile')}">${I('file')}<span>${E(source.name)}<small>${source.provided?'已提供':'待补充'}</small></span>${I('arrow')}</button>`).join('');
    const fileCount=task.intake?.files?.length||0;
    return `<section class="context-card workspace-summary"><header class="context-card-heading"><h2>企业画像</h2><span>已了解 ${known}/${rows.length}</span></header>${window.PolicyMatch?.portraitEditing(task.id) ? window.PolicyMatch.portraitEditor(task) : `<dl class="workspace-portrait">${rows.map(([label,value])=>`<div><dt>${E(label)}</dt><dd${value?'':' class="is-empty"'}>${E(value||'待补充')}</dd></div>`).join('')}${typeof open==='number'?`<div><dt>可申报政策</dt><dd>${open} 项</dd></div>`:''}</dl><button type="button" class="text-button workspace-portrait-edit" data-action="portrait-edit" data-task="${E(task.id)}">补充企业信息</button>`}<details class="workspace-company-materials"><summary><span>企业资料</span><span>${task.sources.filter(source=>source.provided).length}/${task.sources.length} 已提供${fileCount?`，${fileCount} 份文件待核对`:''} ${I('arrow')}</span></summary><div class="workspace-source-list">${sourceHTML || '<p class="muted">尚未提供资料</p>'}</div></details></section>`;
  }
  function renderContext(task, item, {content='',route='task',capabilities=false}={}) {
    const E=U().escape,I=U().icon;
    const versions=versionsFor(task),latest=versions[0];
    const currentMaterial=versionIsCurrent(task,latest) ? latest : null;
    const policy=window.PolicyData.policies.find(p=>p.id === task.policyId);
    const ready=task.requirements.filter(r=>r.status === 'ready').length;
    const count=definitions.filter(([id])=>task.steps[id]).length;
    const isDocumentOpen=!['task','expert'].includes(route);
    const routeButton=(destination,label,id='') => `<button type="button" class="text-button" data-route="${destination}" data-task="${E(task.id)}" data-work="${item.id}"${capabilities?' data-experts="1"':''}${id ? ` data-id="${E(id)}"` : ''}>${E(label)} ${I('arrow')}</button>`;
    const outputWork={interpret:'match',review:'assembly',diagnosis:'assembly',guidance:'guidance'}[item.id] || item.id;
    const outputs=[
      {work:'match',title:'候选政策清单',route:'policy',id:policy?.public?task.policyId:'',ready:task.steps.match,detail:task.steps.match ? policy?.title || '查看适用条件与匹配依据' : '查找适用政策后生成'},
      {work:'assembly',title:'申报材料',route:'version',id:currentMaterial?.id,ready:!!currentMaterial,detail:currentMaterial ? `V${currentMaterial.number} · ${currentMaterial.status==='confirmed'?'已确认':'待核对'}` : latest ? '资料或政策已更新，请重新组稿' : '保存首版材料后生成'},
      {work:'guidance',title:'办理指引',route:'guidance',ready:task.steps.match,detail:task.steps.match ? '办理步骤与提交前检查' : '明确申报政策后查看'},
    ];
    const outputHTML=outputs.map(output=>`<button type="button" class="workspace-output-item${output.work===outputWork?' is-current':''}" title="${E(output.detail)}" data-output-work="${output.work}" data-route="${output.route}"${output.id?` data-id="${E(output.id)}"`:''} data-task="${E(task.id)}" data-work="${item.id}"${capabilities?' data-experts="1"':''}${output.ready?'':' disabled'}${output.work===outputWork?' aria-current="true"':''}>${I('file')}<span><strong>${E(output.title)}</strong><small>${E(output.detail)}</small></span><span class="output-state${output.ready?' is-ready':''}">${output.ready?'查看':'待生成'}</span></button>`).join('');
    const versionHTML=versions.map(version=>{
      const date=new Date(version.createdAt);
      const label=Number.isNaN(date.getTime())?'':date.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
      return `<button type="button" class="workspace-version-item" data-route="version" data-id="${E(version.id)}" data-task="${E(task.id)}" data-work="${item.id}"${capabilities?' data-experts="1"':''}><span class="workspace-version-mark">V${version.number}</span><span class="workspace-version-copy"><strong>${E(version.note || '申报材料')}</strong><time datetime="${E(version.createdAt)}">${E(label)}</time></span><span class="version-state${version.status==='confirmed'?' is-confirmed':''}">${version.status==='confirmed'?'已确认':'待核对'}</span></button>`;
    }).join('');
    const compareLink=versions.length>1?`<a class="workspace-compare-link" href="#compare?left=${encodeURIComponent(versions[1].id)}&amp;right=${encodeURIComponent(versions[0].id)}&amp;work=${item.id}${capabilities?'&amp;experts=1':''}">比较最近两个版本 ${I('arrow')}</a>`:'';
    let documentHTML='';
    if (isDocumentOpen) {
      const template=document.createElement('template');
      template.innerHTML=content;
      const title=template.content.querySelector('h1,h2')?.textContent?.trim() || item.title;
      const closeAttrs=`data-route="${capabilities?'expert':'task'}" data-task="${E(task.id)}" data-work="${item.id}"${capabilities?' data-experts="1"':''}`;
      documentHTML=`<button type="button" class="workspace-document-scrim" ${closeAttrs} aria-label="关闭" tabindex="-1"></button><section class="workspace-document" role="dialog" aria-modal="true" aria-label="${E(title)}"><header class="workspace-document-toolbar"><h2>${E(title)}</h2><button class="icon-button workspace-document-close" ${closeAttrs} aria-label="关闭" title="关闭">${I('close')}</button></header><div class="workspace-content" tabindex="0">${documentContent(content)}</div></section>`;
    }
    return `<aside class="workspace-context" tabindex="0" aria-label="企业画像与输出内容">
      <div class="workspace-context-index">
        ${portraitMarkup(task)}
        <section class="context-card workspace-result" data-result-work="${item.id}"><header class="context-card-heading"><h2>输出内容</h2><span>${outputs.filter(output=>output.ready).length}/${outputs.length}</span></header><div class="workspace-output-list">${outputHTML}</div>${versions.length ? `<section class="workspace-version-list"><header class="context-card-heading"><h3>历史版本</h3><span>${versions.length} 个版本</span></header>${versionHTML}${compareLink}</section>` : ''}</section></div>${documentHTML}
    </aside>`;
  }
  /* 顶部是不可关闭的标签页：写能帮用户做什么，选中的标签和对话区连成一体。 */
  function expertCard(persona,work,selected,attrs) {
    const E=U().escape,I=U().icon;
    // 提交前核对没有单独的入口，由办理指引高亮。
    const active=work.id===selected || work.id==='guidance' && selected==='review';
    const state=work.status==='done' ? `<span class="work-status-tag is-done">${I('check')}<span class="sr-only">${E(work.label)}</span></span>` : work.label ? `<span class="work-status-tag"><span class="sr-only">${E(work.label)}</span></span>` : '';
    return `<button id="expert-tab-${work.id}" role="tab" aria-selected="${active}" aria-controls="workspace-panel" tabindex="${active ? '0' : '-1'}" class="work-status-card${active ? ' is-selected' : ''}" data-status="${work.status}" ${attrs} data-work="${work.id}" aria-label="${E(work.title)}，${E(work.owner)}${work.label ? `，${E(work.label)}` : ''}" title="${E(work.label ? `${work.label}：${persona.can}` : persona.can)}"><span class="work-card-portrait" aria-hidden="true" style="--expert-x:${persona.x}%;--expert-y:${persona.y}%"></span><span class="work-tab-text"><h2>${E(work.title)}</h2><small>${E(tabHint(work.id))}</small></span>${state}</button>`;
  }
  const startAttach = () => `<label class="intake-attach" for="home-files" title="上传资料"><input id="home-files" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png">${U().icon('clip')}<span class="sr-only">上传企业资料</span></label>`;
  /* 只想了解政策：不用企业名称，追问也在这里。 */
  function guestInterpretPanel(question) {
    const E=U().escape,I=U().icon,person=window.PolicyPersonas.get('match');
    const portrait=`--portrait-x:${person.x}%;--portrait-y:${person.y}%`;
    const asked=question?`<div class="chat-message-row is-user"><span class="chat-message-avatar chat-message-user-avatar" aria-hidden="true">企</span><div class="chat-message-body"><span class="chat-message-name">企业负责人</span><p class="chat-message chat-user">${E(question)}</p></div></div>`:'';
    return `<section id="workspace-panel" class="workspace-panel" role="tabpanel" aria-label="政策解读与匹配对话"><section class="adviser-card" aria-label="${E(person.name)}对话"><header><span class="role-avatar chat-expert-avatar" aria-hidden="true" style="${portrait}"></span><div class="chat-header-identity"><h2>${E(person.name)}</h2></div></header><div class="chat-scroll-region" tabindex="0" aria-label="对话记录"><div class="chat-messages">${asked}${window.PolicyMatch.guestMarkup()}</div></div><div class="chat-composer"><form id="adviser-chat-form" data-home="1" data-guest="1">${startAttach()}<label class="sr-only" for="adviser-message">向${E(person.name)}提问</label><textarea id="adviser-message" name="message" rows="1" maxlength="500" required placeholder="问问政策条款、适用范围或材料要求……"></textarea><button type="submit" class="icon-button chat-send" aria-label="发送问题">${I('arrow')}</button></form></div></section></section>`;
  }
  function startShell(selected,panel) {
    const I=U().icon;
    const back=selected?`<button class="icon-button" data-route="dashboard" aria-label="返回首页">${I('arrow')}</button>`:'';
    return `<div class="project-workspace is-start" data-task="" data-work="${selected}" data-capabilities="false" data-view-route="task"><div class="workspace-body">
      <section class="workspace-main" aria-label="选择你的问题">
        <header class="project-workspace-header"><div class="project-heading">${back}<div><h1>只需告诉我企业名称</h1></div></div></header>
        <section class="workspace-conversation" aria-label="对话">${panel}</section>
      </section>
    </div></div>`;
  }
  /* 首页：还没有项目，直接和员工对话，填完企业名称才建项目。 */
  function renderStart(requested,{name='',region='',files=[],question=''}={}) {
    const E=U().escape,I=U().icon;
    const selected=requested;
    if(selected==='interpret')return startShell(selected,guestInterpretPanel(question));
    const person=window.PolicyPersonas.get(selected);
    const portrait=`--portrait-x:${person.x}%;--portrait-y:${person.y}%`;
    const isProfile=false;
    const isAssembly=selected==='assembly';
    const draftField=isAssembly?'<div class="intake-name-row home-draft-row"><label for="start-draft-text">已有稿子</label><textarea id="start-draft-text" name="draftText" rows="5" maxlength="40000" placeholder="有现成的稿子就贴在这里，没有可以不填"></textarea></div>':'';
    const greeting=isAssembly ? '有现成的稿子可以直接贴进来，没有也能按资料整理。告诉我企业名称就能开始。' : isProfile ? '告诉我企业名称，再选几项情况，我帮你找能申报的政策。' : `我可以${person.can}。告诉我企业名称就能开始。`;
    const userBubble=question?`<div class="chat-message-row is-user"><span class="chat-message-avatar chat-message-user-avatar" aria-hidden="true">企</span><div class="chat-message-body"><span class="chat-message-name">企业负责人</span><p class="chat-message chat-user">${E(question)}</p></div></div>`:'';
    const fileList=files.length ? `<ul class="intake-files">${files.map(file=>`<li><span>${E(file.name)}</span><small>已上传</small><button type="button" class="text-button" data-action="home-remove-file" data-file="${E(file.id)}" aria-label="移除${E(file.name)}">移除</button></li>`).join('')}</ul>` : '';
    return startShell(selected,`<section id="workspace-panel" class="workspace-panel" role="tabpanel" aria-label="${E(person.name)}对话"><section class="adviser-card has-intake" aria-label="${E(person.name)}对话">
          <header><span class="role-avatar chat-expert-avatar" aria-hidden="true" style="${portrait}"></span><div class="chat-header-identity"><h2>${E(person.name)}</h2><div class="chat-expert-meta"><span class="muted chat-expert-subject">正在帮你${E(person.doing)}</span></div></div></header>
          <div class="chat-scroll-region" tabindex="0" aria-label="对话记录"><div class="chat-messages">${userBubble}<div class="chat-message-row is-assistant"><span class="chat-message-avatar chat-message-expert-avatar" aria-hidden="true" style="${portrait}"></span><div class="chat-message-body intake-body"><span class="chat-message-name">${E(person.name)}</span><p class="chat-message chat-assistant">${E(greeting)}</p><form id="company-start-form" class="intake-card home-start-card" data-work="${selected}"><div class="intake-name-row"><label for="start-company-name">企业名称</label><input id="start-company-name" name="companyName" type="text" maxlength="300" required autocomplete="organization" placeholder="请输入企业全称" value="${E(name)}"></div>${draftField}<div class="intake-foot is-end"><button type="submit" class="button button-primary">${isProfile?'下一步':'开始'} ${I('arrow')}</button></div></form></div></div></div></div>
          <div class="chat-composer"><form id="adviser-chat-form" data-home="1" data-work="${selected}">${fileList}${startAttach()}<label class="sr-only" for="adviser-message">输入企业全称</label><textarea id="adviser-message" name="message" rows="1" maxlength="60" required placeholder="也可以在这里输入企业全称，发送后开始……"></textarea><button type="submit" class="icon-button chat-send" aria-label="发送企业名称">${I('arrow')}</button></form></div>
        </section></section>`);
  }
  function render(taskId,{workId,content='',route='task',capabilities=false}={}) {
    const task=S().getTask(taskId);
    if (!task) return '<div class="empty-state"><h1>没有找到这个项目</h1><button class="button button-secondary" data-route="dashboard">查看所有项目</button></div>';
    const E=U().escape,I=U().icon;
    const selected=selectedWork(task,workId);
    capabilities=capabilities || ['interpret','guidance'].includes(selected);
    const items=capabilityItems(task);
    // 旧的材料核对会话保留独立身份，即使从六专家视图打开历史版本。
    const item=items.find(i=>i.id === selected) || workItems(task).find(i=>i.id===selected);
    const cards = items.map(work => {
      const persona = window.PolicyPersonas.get(work.id);
      return expertCard(persona,work,selected,`data-action="workspace-expert" data-task="${E(task.id)}"`);
    }).join('');
    const panel=window.PolicyChat.render(task.id,selected,{statusLabel:item?.label});
    const activeTab=selected==='review' ? 'guidance' : selected;
    const panelLabel=items.some(i=>i.id===activeTab) ? `aria-labelledby="expert-tab-${activeTab}"` : `aria-label="${E(window.PolicyPersonas.get(selected).name)}对话"`;
    return `<div class="project-workspace" data-task="${E(task.id)}" data-work="${selected}" data-capabilities="${capabilities}" data-view-route="${E(route)}"><div class="workspace-body${!['task','expert'].includes(route) ? ' is-document-open' : ''}">
      <section class="workspace-main" aria-label="项目专家工作区">
        <header class="project-workspace-header"><div class="project-heading"><button class="icon-button" data-route="dashboard" aria-label="查看所有项目">${I('arrow')}</button><div><h1 title="${E(task.title)}">${E(task.title)}</h1><p class="muted">${E(task.company.name || '企业档案待填写')}</p></div></div></header>
        <section class="workspace-conversation" aria-label="专家协作"><div class="workspace-expert-strip"><button class="expert-scroll-control" type="button" data-action="workspace-expert-scroll" data-direction="-1" aria-label="向左查看更多专家" hidden disabled>${I('arrow')}</button><nav class="workspace-status-grid${capabilities?' is-capability-grid':''}" role="tablist" aria-label="项目专家与负责事项">${cards}</nav><button class="expert-scroll-control" type="button" data-action="workspace-expert-scroll" data-direction="1" aria-label="向右查看更多专家" hidden disabled>${I('arrow')}</button></div><section id="workspace-panel" class="workspace-panel" role="tabpanel" ${panelLabel}>${panel}</section></section>
      </section>${renderContext(task,item,{content,route,capabilities})}
    </div></div>`;
  }
  window.PolicyWorkspace=Object.freeze({workItems,selectedWork,orderedItems,contentDestination,leave,render,renderStart,portraitMarkup});
})();
