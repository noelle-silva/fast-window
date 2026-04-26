"use strict";(()=>{(function(){let h="default",y="__all__",f={list:"bookmarks.list",inferIcon:"bookmarks.inferIcon",addBookmark:"bookmarks.add",updateBookmark:"bookmarks.update",deleteBookmark:"bookmarks.delete",openBookmark:"bookmarks.open",refreshIcon:"bookmarks.refreshIcon",addGroup:"bookmarks.addGroup",renameGroup:"bookmarks.renameGroup",deleteGroup:"bookmarks.deleteGroup"};function N(t){var a;let r=t||{};if(!((a=r.background)!=null&&a.invoke))throw new Error("网站收藏需要 v4 background.invoke");return r}let k=N(window.fastWindow);async function b(t,a){return k.background.invoke(t,a!=null?a:null)}function s(t){var a,r;let n=String(t||"").trim();n&&((r=(a=k.host)==null?void 0:a.toast)==null||r.call(a,n).catch(()=>{}))}let e={loading:!0,groupId:y,search:"",data:{schemaVersion:1,groups:[],items:[]},modal:null,editId:"",addTitle:"",addUrl:"",addGroupId:h,addIconUrl:"",ctxMenu:{open:!1,id:"",x:0,y:0},newGroupName:"",groupNameEdits:{},confirmKey:"",confirmUntil:0},z=`
    :root {
      --bg: #FAFAFA;
      --surface: #FFFFFF;
      --text: #212121;
      --muted: #757575;
      --outline: #E0E0E0;
      --primary: #1976D2;
      --danger: #D32F2F;
      --shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);
      --radius: 12px;
    }
    * { box-sizing: border-box; }
    body { background: var(--bg); color: var(--text); }
    .wrap { height: 100vh; display: flex; flex-direction: column; }
    .topbar {
      height: 44px;
      background: var(--surface);
      border-bottom: 1px solid var(--outline);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      box-shadow: var(--shadow);
      flex-shrink: 0;
    }
    .title { font-weight: 800; font-size: 13px; margin-right: auto; }
    .btn {
      border: 1px solid var(--outline);
      background: var(--surface);
      color: var(--text);
      height: 30px;
      padding: 0 10px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 12px;
      line-height: 28px;
    }
    .btn.primary { border-color: transparent; background: var(--primary); color: white; }
    .btn.danger { border-color: transparent; background: var(--danger); color: white; }
    .btn[disabled] { opacity: 0.55; cursor: not-allowed; }
    .filters { display: flex; gap: 10px; padding: 10px; flex-shrink: 0; }
    .field { display: flex; flex-direction: column; gap: 6px; min-width: 120px; }
    .field.grow { flex: 1; min-width: 0; }
    .label { font-size: 11px; color: var(--muted); }
    select, input {
      height: 34px;
      border: 1px solid var(--outline);
      border-radius: 10px;
      padding: 0 10px;
      font-size: 13px;
      outline: none;
      background: white;
      color: var(--text);
    }
    .content { flex: 1; overflow: auto; padding: 10px; }
    .list { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 12px; align-content: start; }
    .tile {
      background: var(--surface);
      border: 1px solid var(--outline);
      border-radius: var(--radius);
      padding: 12px 10px;
      box-shadow: var(--shadow);
      cursor: pointer;
      user-select: none;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .tile:focus { outline: 2px solid rgba(25,118,210,0.28); outline-offset: 2px; }
    .tileName {
      font-weight: 800;
      font-size: 12px;
      line-height: 1.2;
      width: 100%;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spacer { margin-left: auto; }
    .empty { color: var(--muted); text-align: center; padding: 28px 0; font-size: 13px; }
    .siteIcon {
      width: 52px;
      height: 52px;
      border-radius: 999px;
      border: 1px solid var(--outline);
      background: white;
      box-shadow: 0 1px 2px rgba(0,0,0,0.08);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      flex-shrink: 0;
    }
    .siteIcon.small { width: 24px; height: 24px; border-radius: 6px; }
    .siteIcon img { width: 100%; height: 100%; display: block; }
    .siteIcon.ok .fallback { display: none; }
    .siteIcon.err img { display: none; }
    .fallback { font-size: 22px; color: var(--muted); line-height: 1; }
    .siteIcon.small .fallback { font-size: 13px; }
    .overlay[hidden], .ctxBackdrop[hidden], .ctxMenu[hidden] { display: none; }
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .modal {
      width: min(560px, 100%);
      background: var(--surface);
      border: 1px solid var(--outline);
      border-radius: 14px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.25);
      overflow: hidden;
    }
    .modalHead { display: flex; align-items: center; gap: 8px; padding: 10px; border-bottom: 1px solid var(--outline); }
    .modalTitle { font-size: 13px; font-weight: 800; margin-right: auto; }
    .modalBody { padding: 10px; display: flex; flex-direction: column; gap: 10px; }
    .row { display: flex; gap: 10px; align-items: center; }
    .row.grow { align-items: stretch; }
    .row .grow { flex: 1; min-width: 0; }
    .help { font-size: 12px; color: var(--muted); }
    .groupRow { display: flex; gap: 8px; align-items: center; padding: 8px; border: 1px solid var(--outline); border-radius: 12px; background: white; }
    .groupRow input { flex: 1; }
    .iconLine { display: flex; align-items: center; gap: 10px; }
    .ctxBackdrop { position: fixed; inset: 0; background: transparent; z-index: 50; }
    .ctxMenu {
      position: fixed;
      z-index: 60;
      min-width: 160px;
      background: var(--surface);
      border: 1px solid var(--outline);
      border-radius: 12px;
      box-shadow: 0 12px 30px rgba(0,0,0,0.22);
      padding: 6px;
    }
    .ctxItem {
      width: 100%;
      height: 34px;
      padding: 0 10px;
      border: 0;
      background: transparent;
      border-radius: 10px;
      cursor: pointer;
      text-align: left;
      color: var(--text);
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ctxItem:hover { background: rgba(0,0,0,0.06); }
    .ctxItem.danger { color: var(--danger); }
    .ctxSep { height: 1px; background: var(--outline); margin: 6px 4px; }
  `;function m(t){return String(t).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}function v(){e.ctxMenu.open=!1,e.ctxMenu.id=""}function x(){let t=document.querySelector('[data-role="ctxMenu"]'),a=document.querySelector('[data-role="ctxBackdrop"]');if(!(t instanceof HTMLElement)||!(a instanceof HTMLElement))return;let r=e.ctxMenu.open&&!e.modal&&String(e.ctxMenu.id||"").trim();if(t.hidden=!r,a.hidden=!r,!r)return;let n=Number(e.ctxMenu.x||0),i=Number(e.ctxMenu.y||0);t.style.left=`${n}px`,t.style.top=`${i}px`,requestAnimationFrame(()=>{if(t.hidden)return;let o=8,d=t.getBoundingClientRect(),g=n,l=i;g+d.width>window.innerWidth-o&&(g=window.innerWidth-o-d.width),l+d.height>window.innerHeight-o&&(l=window.innerHeight-o-d.height),g=Math.max(o,g),l=Math.max(o,l),t.style.left=`${g}px`,t.style.top=`${l}px`})}function T(t){return e.data.items.find(a=>a.id===t)||null}function F(){let t=String(e.search||"").trim().toLowerCase(),a=e.groupId;return e.data.items.filter(r=>a!==y&&r.groupId!==a?!1:t?String(r.title||"").toLowerCase().includes(t)||String(r.url||"").toLowerCase().includes(t):!0)}function S(t,a){let r=Date.now();return e.confirmKey===t&&e.confirmUntil>r?(e.confirmKey="",e.confirmUntil=0,!0):(e.confirmKey=t,e.confirmUntil=r+2500,s(a||"再点一次确认"),!1)}async function C(){e.data=await b(f.list,{}),e.data.groups.some(t=>t.id===e.addGroupId)||(e.addGroupId=h),e.loading=!1}async function D(){await C(),u()}function H(t){e.modal=t,t==="add"&&(e.editId="",e.addTitle="",e.addUrl="",e.addGroupId=e.groupId===y?h:e.groupId,e.addIconUrl=""),t==="groups"&&(e.newGroupName="",e.groupNameEdits={}),u()}function j(t){let a=T(t);if(!a){s("条目不存在");return}e.modal="add",e.editId=t,e.addTitle=String(a.title||""),e.addUrl=String(a.url||""),e.addGroupId=e.data.groups.some(n=>n.id===a.groupId)?String(a.groupId):h,e.addIconUrl=String(a.iconUrl||""),v(),u();let r=document.querySelector('input[data-act="addTitle"]');r instanceof HTMLInputElement&&(r.focus(),r.select())}function I(){e.modal=null,e.editId="",u()}async function R(){let t={id:String(e.editId||"").trim(),title:e.addTitle,url:e.addUrl,groupId:e.addGroupId,iconUrl:e.addIconUrl};try{e.data=await b(t.id?f.updateBookmark:f.addBookmark,t),s(t.id?"已保存":"已添加"),I()}catch(a){s(String((a==null?void 0:a.message)||a||"保存失败"))}}async function K(t){try{e.data=await b(f.deleteBookmark,{id:t}),s("已删除"),u()}catch(a){s(String((a==null?void 0:a.message)||a||"删除失败"))}}async function M(t){if(T(t))try{e.data=await b(f.openBookmark,{id:t}),u()}catch(a){s(String((a==null?void 0:a.message)||a||"打开失败"))}}async function W(t){try{e.data=await b(f.refreshIcon,{id:t}),s("已刷新图标地址"),u()}catch(a){s(String((a==null?void 0:a.message)||a||"刷新失败"))}}async function _(){try{let t=await b(f.inferIcon,{url:e.addUrl});e.addIconUrl=String((t==null?void 0:t.iconUrl)||""),s(e.addIconUrl?"已推断图标地址":"未找到图标"),u()}catch(t){s(String((t==null?void 0:t.message)||t||"图标推断失败"))}}async function O(){let t=String(e.newGroupName||"").trim();if(t)try{e.data=await b(f.addGroup,{name:t}),e.newGroupName="",u()}catch(a){s(String((a==null?void 0:a.message)||a||"添加失败"))}}async function P(t){var a;let r=String((a=e.groupNameEdits[t])!=null?a:"").trim();if(r)try{e.data=await b(f.renameGroup,{groupId:t,name:r}),s("已保存"),u()}catch(n){s(String((n==null?void 0:n.message)||n||"保存失败"))}}async function V(t){if(t!==h&&S(`delGroup:${t}`,"再点一次删除分组（收藏会移到「默认」）"))try{e.data=await b(f.deleteGroup,{groupId:t}),e.groupId===t&&(e.groupId=y),s("已删除"),u()}catch(a){s(String((a==null?void 0:a.message)||a||"删除失败"))}}function X(){let t=document.getElementById("app")||document.body;t.innerHTML=`
      <style>${z}</style>
      <div class="wrap">
        <div class="topbar">
          <button class="btn" data-act="back" aria-label="返回主页" title="返回主页">←</button>
          <div class="title">网站收藏</div>
          <button class="btn" data-act="groups" aria-label="分组管理" title="分组管理">分组</button>
          <button class="btn primary" data-act="add" aria-label="新增收藏" title="新增收藏">新增</button>
        </div>
        <div class="filters">
          <label class="field">
            <span class="label">分组</span>
            <select data-act="group" aria-label="分组筛选"></select>
          </label>
          <label class="field grow">
            <span class="label">搜索</span>
            <input data-act="search" aria-label="搜索" placeholder="按标题 / URL 搜索" />
          </label>
        </div>
        <div class="content">
          <div class="list" data-area="list"></div>
          <div class="empty" data-area="empty" style="display:none"></div>
        </div>
        <div class="overlay" data-role="overlayAdd" hidden>
          <div class="modal" data-role="addModal" role="dialog" aria-modal="true" aria-label="新增收藏">
            <div class="modalHead">
              <div class="modalTitle" data-role="addModalTitle">新增收藏</div>
              <button class="btn" data-act="closeAdd">关闭</button>
            </div>
            <div class="modalBody">
              <label class="field"><span class="label">标题（可选）</span><input data-act="addTitle" placeholder="例如：GitHub" /></label>
              <label class="field"><span class="label">URL</span><input data-act="addUrl" placeholder="https://example.com（可省略协议）" /></label>
              <div class="row">
                <div class="iconLine">
                  <div class="siteIcon small" data-role="addIconWrap"><span class="fallback">🌐</span><img data-role="addIconImg" alt="网站图标" /></div>
                  <div class="help">v4 后台负责推断 favicon 与持久化数据</div>
                </div>
                <div class="spacer"></div>
                <button class="btn" data-act="sniffAddIcon">推断图标</button>
                <button class="btn" data-act="clearAddIcon">清除</button>
              </div>
              <label class="field"><span class="label">分组</span><select data-act="addGroup" aria-label="选择分组"></select></label>
              <div class="row">
                <div class="help">仅支持 http(s)://</div>
                <div class="spacer"></div>
                <button class="btn" data-act="closeAdd">取消</button>
                <button class="btn primary" data-role="addConfirmBtn" data-act="confirmAdd">添加</button>
              </div>
            </div>
          </div>
        </div>
        <div class="overlay" data-role="overlayGroups" hidden>
          <div class="modal" role="dialog" aria-modal="true" aria-label="分组管理">
            <div class="modalHead"><div class="modalTitle">分组管理</div><button class="btn" data-act="closeGroups">关闭</button></div>
            <div class="modalBody">
              <div class="help">删除分组会把收藏移动到「默认」</div>
              <div data-area="groupsList"></div>
              <div class="row grow"><input class="grow" data-act="newGroupName" placeholder="新分组名" /><button class="btn primary" data-act="addGroup">添加</button></div>
            </div>
          </div>
        </div>
        <div class="ctxBackdrop" data-role="ctxBackdrop" hidden></div>
        <div class="ctxMenu" data-role="ctxMenu" hidden role="menu" aria-label="收藏操作">
          <button class="ctxItem" data-act="ctxOpen" role="menuitem">↗ 打开</button>
          <button class="ctxItem" data-act="ctxEdit" role="menuitem">✎ 编辑</button>
          <button class="ctxItem" data-act="ctxSniff" role="menuitem">⟳ 刷新图标</button>
          <div class="ctxSep" role="separator"></div>
          <button class="ctxItem danger" data-act="ctxDelete" role="menuitem">删除</button>
        </div>
      </div>
    `;let a=t.querySelector(".topbar");a&&a.addEventListener("pointerdown",r=>{var n,i;if(!(r instanceof PointerEvent)||r.button!==0)return;let o=r.target;o instanceof HTMLElement&&(o.closest('button, a, input, textarea, select, [role="button"]')||(i=(n=k.host)==null?void 0:n.startDragging)==null||i.call(n).catch(()=>{}))}),t.addEventListener("click",r=>{var n,i;let o=r.target;if(!(o instanceof HTMLElement))return;let d=o.getAttribute("data-act");if(d==="ctxOpen"){let l=String(e.ctxMenu.id||"").trim();if(v(),x(),l)return M(l)}if(d==="ctxEdit"){let l=String(e.ctxMenu.id||"").trim();if(v(),x(),l)return j(l)}if(d==="ctxSniff"){let l=String(e.ctxMenu.id||"").trim();if(v(),x(),l)return W(l)}if(d==="ctxDelete"){let l=String(e.ctxMenu.id||"").trim();return v(),x(),!l||!S(`del:${l}`,"再点一次删除这条收藏")?void 0:K(l)}if(o.getAttribute("data-role")==="ctxBackdrop"){v(),x();return}if(e.ctxMenu.open&&!o.closest('[data-role="ctxMenu"]')&&(v(),x()),d==="back")return(i=(n=k.host)==null?void 0:n.back)==null?void 0:i.call(n);if(d==="add")return H("add");if(d==="groups")return H("groups");if(d==="closeAdd"||d==="closeGroups")return I();if(d==="confirmAdd")return R();if(d==="sniffAddIcon")return _();if(d==="clearAddIcon"){e.addIconUrl="",u();return}if(d==="addGroup")return O();if(d==="saveGroup")return P(String(o.getAttribute("data-id")||""));if(d==="delGroup")return V(String(o.getAttribute("data-id")||""));let g=o.closest('[data-act="open"]');if(g instanceof HTMLElement){let l=String(g.getAttribute("data-id")||"");if(l)return M(l)}}),t.addEventListener("contextmenu",r=>{let n=r.target;if(!(n instanceof HTMLElement)||e.modal)return;let i=n.closest('[data-role="tile"]');if(!(i instanceof HTMLElement))return;let o=String(i.getAttribute("data-id")||"").trim();o&&(r.preventDefault(),e.ctxMenu.open=!0,e.ctxMenu.id=o,e.ctxMenu.x=r.clientX,e.ctxMenu.y=r.clientY,x())}),t.addEventListener("input",r=>{let n=r.target;if(!(n instanceof HTMLElement))return;let i=n.getAttribute("data-act");if(i==="search"&&n instanceof HTMLInputElement){e.search=n.value,u();return}if(i==="addTitle"&&n instanceof HTMLInputElement&&(e.addTitle=n.value),i==="addUrl"&&n instanceof HTMLInputElement&&(e.addUrl=n.value),i==="newGroupName"&&n instanceof HTMLInputElement&&(e.newGroupName=n.value),i==="groupName"&&n instanceof HTMLInputElement){let o=String(n.getAttribute("data-id")||"");o&&(e.groupNameEdits[o]=n.value)}}),t.addEventListener("change",r=>{let n=r.target;if(!(n instanceof HTMLElement))return;let i=n.getAttribute("data-act");i==="group"&&n instanceof HTMLSelectElement&&(e.groupId=n.value||y,u()),i==="addGroup"&&n instanceof HTMLSelectElement&&(e.addGroupId=n.value||h)}),t.addEventListener("load",r=>{let n=r.target;if(!(n instanceof HTMLImageElement))return;let i=n.closest(".siteIcon");i instanceof HTMLElement&&(i.classList.add("ok"),i.classList.remove("err"))},!0),t.addEventListener("error",r=>{let n=r.target;if(!(n instanceof HTMLImageElement))return;let i=n.closest(".siteIcon");i instanceof HTMLElement&&(i.classList.add("err"),i.classList.remove("ok"))},!0),t.addEventListener("keydown",r=>{if(r.key==="Escape"){if(e.ctxMenu.open){v(),x();return}e.modal&&I();return}if(r.key==="Enter"&&!e.modal&&!e.ctxMenu.open){let n=document.activeElement;if(n instanceof HTMLInputElement||n instanceof HTMLTextAreaElement||n instanceof HTMLSelectElement)return;let i=n instanceof HTMLElement?n.closest('[data-role="tile"]'):null;if(i instanceof HTMLElement){let o=String(i.getAttribute("data-id")||"").trim();if(o)return M(o)}}}),t.addEventListener("scroll",()=>{e.ctxMenu.open&&(v(),x())},!0)}function u(){let t=document.querySelector('[data-role="overlayAdd"]'),a=document.querySelector('[data-role="overlayGroups"]');t instanceof HTMLElement&&(t.hidden=e.modal!=="add"),a instanceof HTMLElement&&(a.hidden=e.modal!=="groups");let r=document.querySelector('input[data-act="search"]');r instanceof HTMLInputElement&&(r.value=e.search);let n=document.querySelector('select[data-act="group"]'),i=document.querySelector('select[data-act="addGroup"]');if(n instanceof HTMLSelectElement){let c=[{id:y,name:"全部"},...e.data.groups];n.innerHTML=c.map(p=>`<option value="${m(p.id)}">${m(p.name)}</option>`).join(""),n.value=e.groupId||y}i instanceof HTMLSelectElement&&(i.innerHTML=e.data.groups.map(c=>`<option value="${m(c.id)}">${m(c.name)}</option>`).join(""),i.value=e.addGroupId||h);let o=document.querySelector('[data-area="list"]'),d=document.querySelector('[data-area="empty"]');if(!(o instanceof HTMLElement)||!(d instanceof HTMLElement))return;if(e.loading){o.innerHTML="",d.style.display="block",d.textContent="加载中...";return}let g=F();g.length?(d.style.display="none",o.innerHTML=g.map(c=>{let p=String(c.iconUrl||"").trim(),E=p?`<img alt="网站图标" loading="lazy" referrerpolicy="no-referrer" src="${m(p)}" />`:'<img alt="网站图标" loading="lazy" referrerpolicy="no-referrer" />';return`
          <div class="tile" tabindex="0" data-role="tile" data-act="open" data-id="${m(c.id)}" title="${m(c.url)}">
            <div class="siteIcon" aria-hidden="true"><span class="fallback">🌐</span>${E}</div>
            <div class="tileName">${m(c.title||c.url)}</div>
          </div>
        `}).join("")):(o.innerHTML="",d.style.display="block",d.textContent=e.search?"未找到匹配的收藏":"暂无收藏"),x();let l=document.querySelector('[data-area="groupsList"]');l instanceof HTMLElement&&(l.innerHTML=e.data.groups.slice().sort((c,p)=>c.createdAt-p.createdAt).map(c=>{let p=e.groupNameEdits[c.id],E=typeof p=="string"?p:c.name,J=c.id!==h;return`
          <div class="groupRow">
            <input data-act="groupName" data-id="${m(c.id)}" value="${m(E)}" aria-label="分组名" />
            <button class="btn" data-act="saveGroup" data-id="${m(c.id)}">保存</button>
            ${J?`<button class="btn danger" data-act="delGroup" data-id="${m(c.id)}">删除</button>`:'<button class="btn" disabled title="默认分组不可删除">锁定</button>'}
          </div>
        `}).join(""));let G=document.querySelector('input[data-act="addTitle"]'),A=document.querySelector('input[data-act="addUrl"]'),U=document.querySelector('input[data-act="newGroupName"]');G instanceof HTMLInputElement&&(G.value=e.addTitle),A instanceof HTMLInputElement&&(A.value=e.addUrl),U instanceof HTMLInputElement&&(U.value=e.newGroupName);let L=!!String(e.editId||"").trim(),B=document.querySelector('[data-role="addModal"]'),q=document.querySelector('[data-role="addModalTitle"]'),$=document.querySelector('[data-role="addConfirmBtn"]');B instanceof HTMLElement&&B.setAttribute("aria-label",L?"编辑收藏":"新增收藏"),q instanceof HTMLElement&&(q.textContent=L?"编辑收藏":"新增收藏"),$ instanceof HTMLButtonElement&&($.textContent=L?"保存":"添加");let w=document.querySelector('img[data-role="addIconImg"]');if(w instanceof HTMLImageElement){w.setAttribute("referrerpolicy","no-referrer");let c=String(e.addIconUrl||"").trim(),p=w.closest(".siteIcon");c?(w.src=c,p instanceof HTMLElement&&p.classList.remove("err")):(w.removeAttribute("src"),p instanceof HTMLElement&&(p.classList.remove("ok"),p.classList.remove("err")))}}async function Y(){X(),u();try{await D()}catch(t){e.loading=!1,u(),s(String((t==null?void 0:t.message)||t||"加载失败"))}}Y()})();})();

//# sourceURL=fast-window-plugin:bookmarks/index.js

