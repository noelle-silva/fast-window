import { createDirectBackgroundClient } from './directClient';"use strict";(()=>{(async function(){let h="default",y="__all__",g={list:"bookmarks.list",inferIcon:"bookmarks.inferIcon",addBookmark:"bookmarks.add",updateBookmark:"bookmarks.update",deleteBookmark:"bookmarks.delete",openBookmark:"bookmarks.open",refreshIcon:"bookmarks.refreshIcon",addGroup:"bookmarks.addGroup",renameGroup:"bookmarks.renameGroup",deleteGroup:"bookmarks.deleteGroup"};async function $(e){let n=e||{};return{host:n.host||{},background:await createDirectBackgroundClient(n)}}let k=await $(window.fastWindow);async function b(e,n){return k.background.invoke(e,n!=null?n:null)}function s(e){var r,a;let n=String(e||"").trim();n&&((a=(r=k.host)==null?void 0:r.toast)==null||a.call(r,n).catch(()=>{}))}let t={loading:!0,groupId:y,search:"",data:{schemaVersion:1,groups:[],items:[]},modal:null,editId:"",addTitle:"",addUrl:"",addGroupId:h,addIconUrl:"",ctxMenu:{open:!1,id:"",x:0,y:0},newGroupName:"",groupNameEdits:{},confirmKey:"",confirmUntil:0},z=`
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
  `;function f(e){return String(e).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}function v(){t.ctxMenu.open=!1,t.ctxMenu.id=""}function x(){let e=document.querySelector('[data-role="ctxMenu"]'),n=document.querySelector('[data-role="ctxBackdrop"]');if(!(e instanceof HTMLElement)||!(n instanceof HTMLElement))return;let r=t.ctxMenu.open&&!t.modal&&String(t.ctxMenu.id||"").trim();if(e.hidden=!r,n.hidden=!r,!r)return;let a=Number(t.ctxMenu.x||0),o=Number(t.ctxMenu.y||0);e.style.left=`${a}px`,e.style.top=`${o}px`,requestAnimationFrame(()=>{if(e.hidden)return;let i=8,u=e.getBoundingClientRect(),m=a,d=o;m+u.width>window.innerWidth-i&&(m=window.innerWidth-i-u.width),d+u.height>window.innerHeight-i&&(d=window.innerHeight-i-u.height),m=Math.max(i,m),d=Math.max(i,d),e.style.left=`${m}px`,e.style.top=`${d}px`})}function T(e){return t.data.items.find(n=>n.id===e)||null}function F(){let e=String(t.search||"").trim().toLowerCase(),n=t.groupId;return t.data.items.filter(r=>n!==y&&r.groupId!==n?!1:e?String(r.title||"").toLowerCase().includes(e)||String(r.url||"").toLowerCase().includes(e):!0)}function S(e,n){let r=Date.now();return t.confirmKey===e&&t.confirmUntil>r?(t.confirmKey="",t.confirmUntil=0,!0):(t.confirmKey=e,t.confirmUntil=r+2500,s(n||"再点一次确认"),!1)}async function C(){t.data=await b(g.list,{}),t.data.groups.some(e=>e.id===t.addGroupId)||(t.addGroupId=h),t.loading=!1}async function D(){await C(),c()}function H(e){t.modal=e,e==="add"&&(t.editId="",t.addTitle="",t.addUrl="",t.addGroupId=t.groupId===y?h:t.groupId,t.addIconUrl=""),e==="groups"&&(t.newGroupName="",t.groupNameEdits={}),c()}function R(e){let n=T(e);if(!n){s("条目不存在");return}t.modal="add",t.editId=e,t.addTitle=String(n.title||""),t.addUrl=String(n.url||""),t.addGroupId=t.data.groups.some(a=>a.id===n.groupId)?String(n.groupId):h,t.addIconUrl=String(n.iconUrl||""),v(),c();let r=document.querySelector('input[data-act="addTitle"]');r instanceof HTMLInputElement&&(r.focus(),r.select())}function M(){t.modal=null,t.editId="",c()}async function _(){let e={id:String(t.editId||"").trim(),title:t.addTitle,url:t.addUrl,groupId:t.addGroupId,iconUrl:t.addIconUrl};try{t.data=await b(e.id?g.updateBookmark:g.addBookmark,e),s(e.id?"已保存":"已添加"),M()}catch(n){s(String((n==null?void 0:n.message)||n||"保存失败"))}}async function j(e){try{t.data=await b(g.deleteBookmark,{id:e}),s("已删除"),c()}catch(n){s(String((n==null?void 0:n.message)||n||"删除失败"))}}async function I(e){if(T(e))try{t.data=await b(g.openBookmark,{id:e}),c()}catch(r){s(String((r==null?void 0:r.message)||r||"打开失败"))}}async function O(e){try{t.data=await b(g.refreshIcon,{id:e}),s("已刷新图标地址"),c()}catch(n){s(String((n==null?void 0:n.message)||n||"刷新失败"))}}async function K(){try{let e=await b(g.inferIcon,{url:t.addUrl});t.addIconUrl=String((e==null?void 0:e.iconUrl)||""),s(t.addIconUrl?"已推断图标地址":"未找到图标"),c()}catch(e){s(String((e==null?void 0:e.message)||e||"图标推断失败"))}}async function W(){let e=String(t.newGroupName||"").trim();if(e)try{t.data=await b(g.addGroup,{name:e}),t.newGroupName="",c()}catch(n){s(String((n==null?void 0:n.message)||n||"添加失败"))}}async function P(e){var r;let n=String((r=t.groupNameEdits[e])!=null?r:"").trim();if(n)try{t.data=await b(g.renameGroup,{groupId:e,name:n}),s("已保存"),c()}catch(a){s(String((a==null?void 0:a.message)||a||"保存失败"))}}async function V(e){if(e!==h&&S(`delGroup:${e}`,"再点一次删除分组（收藏会移到「默认」）"))try{t.data=await b(g.deleteGroup,{groupId:e}),t.groupId===e&&(t.groupId=y),s("已删除"),c()}catch(n){s(String((n==null?void 0:n.message)||n||"删除失败"))}}function X(){let e=document.getElementById("app")||document.body;e.innerHTML=`
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
    <div class="help">v4.5 后台负责推断 favicon 与持久化数据</div>
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
    `;let n=e.querySelector(".topbar");n&&n.addEventListener("pointerdown",r=>{var o,i;if(!(r instanceof PointerEvent)||r.button!==0)return;let a=r.target;a instanceof HTMLElement&&(a.closest('button, a, input, textarea, select, [role="button"]')||(i=(o=k.host)==null?void 0:o.startDragging)==null||i.call(o).catch(()=>{}))}),e.addEventListener("click",r=>{var u,m;let a=r.target;if(!(a instanceof HTMLElement))return;let o=a.getAttribute("data-act");if(o==="ctxOpen"){let d=String(t.ctxMenu.id||"").trim();if(v(),x(),d)return I(d)}if(o==="ctxEdit"){let d=String(t.ctxMenu.id||"").trim();if(v(),x(),d)return R(d)}if(o==="ctxSniff"){let d=String(t.ctxMenu.id||"").trim();if(v(),x(),d)return O(d)}if(o==="ctxDelete"){let d=String(t.ctxMenu.id||"").trim();return v(),x(),!d||!S(`del:${d}`,"再点一次删除这条收藏")?void 0:j(d)}if(a.getAttribute("data-role")==="ctxBackdrop"){v(),x();return}if(t.ctxMenu.open&&!a.closest('[data-role="ctxMenu"]')&&(v(),x()),o==="back")return(m=(u=k.host)==null?void 0:u.back)==null?void 0:m.call(u);if(o==="add")return H("add");if(o==="groups")return H("groups");if(o==="closeAdd"||o==="closeGroups")return M();if(o==="confirmAdd")return _();if(o==="sniffAddIcon")return K();if(o==="clearAddIcon"){t.addIconUrl="",c();return}if(o==="addGroup")return W();if(o==="saveGroup")return P(String(a.getAttribute("data-id")||""));if(o==="delGroup")return V(String(a.getAttribute("data-id")||""));let i=a.closest('[data-act="open"]');if(i instanceof HTMLElement){let d=String(i.getAttribute("data-id")||"");if(d)return I(d)}}),e.addEventListener("contextmenu",r=>{let a=r.target;if(!(a instanceof HTMLElement)||t.modal)return;let o=a.closest('[data-role="tile"]');if(!(o instanceof HTMLElement))return;let i=String(o.getAttribute("data-id")||"").trim();i&&(r.preventDefault(),t.ctxMenu.open=!0,t.ctxMenu.id=i,t.ctxMenu.x=r.clientX,t.ctxMenu.y=r.clientY,x())}),e.addEventListener("input",r=>{let a=r.target;if(!(a instanceof HTMLElement))return;let o=a.getAttribute("data-act");if(o==="search"&&a instanceof HTMLInputElement){t.search=a.value,c();return}if(o==="addTitle"&&a instanceof HTMLInputElement&&(t.addTitle=a.value),o==="addUrl"&&a instanceof HTMLInputElement&&(t.addUrl=a.value),o==="newGroupName"&&a instanceof HTMLInputElement&&(t.newGroupName=a.value),o==="groupName"&&a instanceof HTMLInputElement){let i=String(a.getAttribute("data-id")||"");i&&(t.groupNameEdits[i]=a.value)}}),e.addEventListener("change",r=>{let a=r.target;if(!(a instanceof HTMLElement))return;let o=a.getAttribute("data-act");o==="group"&&a instanceof HTMLSelectElement&&(t.groupId=a.value||y,c()),o==="addGroup"&&a instanceof HTMLSelectElement&&(t.addGroupId=a.value||h)}),e.addEventListener("load",r=>{let a=r.target;if(!(a instanceof HTMLImageElement))return;let o=a.closest(".siteIcon");o instanceof HTMLElement&&(o.classList.add("ok"),o.classList.remove("err"))},!0),e.addEventListener("error",r=>{let a=r.target;if(!(a instanceof HTMLImageElement))return;let o=a.closest(".siteIcon");o instanceof HTMLElement&&(o.classList.add("err"),o.classList.remove("ok"))},!0),e.addEventListener("keydown",r=>{if(r.key==="Escape"){if(t.ctxMenu.open){v(),x();return}t.modal&&M();return}if(r.key==="Enter"&&!t.modal&&!t.ctxMenu.open){let a=document.activeElement;if(a instanceof HTMLInputElement||a instanceof HTMLTextAreaElement||a instanceof HTMLSelectElement)return;let o=a instanceof HTMLElement?a.closest('[data-role="tile"]'):null;if(o instanceof HTMLElement){let i=String(o.getAttribute("data-id")||"").trim();if(i)return I(i)}}}),e.addEventListener("scroll",()=>{t.ctxMenu.open&&(v(),x())},!0)}function c(){let e=document.querySelector('[data-role="overlayAdd"]'),n=document.querySelector('[data-role="overlayGroups"]');e instanceof HTMLElement&&(e.hidden=t.modal!=="add"),n instanceof HTMLElement&&(n.hidden=t.modal!=="groups");let r=document.querySelector('input[data-act="search"]');r instanceof HTMLInputElement&&(r.value=t.search);let a=document.querySelector('select[data-act="group"]'),o=document.querySelector('select[data-act="addGroup"]');if(a instanceof HTMLSelectElement){let l=[{id:y,name:"全部"},...t.data.groups];a.innerHTML=l.map(p=>`<option value="${f(p.id)}">${f(p.name)}</option>`).join(""),a.value=t.groupId||y}o instanceof HTMLSelectElement&&(o.innerHTML=t.data.groups.map(l=>`<option value="${f(l.id)}">${f(l.name)}</option>`).join(""),o.value=t.addGroupId||h);let i=document.querySelector('[data-area="list"]'),u=document.querySelector('[data-area="empty"]');if(!(i instanceof HTMLElement)||!(u instanceof HTMLElement))return;if(t.loading){i.innerHTML="",u.style.display="block",u.textContent="加载中...";return}let m=F();m.length?(u.style.display="none",i.innerHTML=m.map(l=>{let p=String(l.iconUrl||"").trim(),E=p?`<img alt="网站图标" loading="lazy" referrerpolicy="no-referrer" src="${f(p)}" />`:'<img alt="网站图标" loading="lazy" referrerpolicy="no-referrer" />';return`
          <div class="tile" tabindex="0" data-role="tile" data-act="open" data-id="${f(l.id)}" title="${f(l.url)}">
            <div class="siteIcon" aria-hidden="true"><span class="fallback">🌐</span>${E}</div>
            <div class="tileName">${f(l.title||l.url)}</div>
          </div>
        `}).join("")):(i.innerHTML="",u.style.display="block",u.textContent=t.search?"未找到匹配的收藏":"暂无收藏"),x();let d=document.querySelector('[data-area="groupsList"]');d instanceof HTMLElement&&(d.innerHTML=t.data.groups.slice().sort((l,p)=>l.createdAt-p.createdAt).map(l=>{let p=t.groupNameEdits[l.id],E=typeof p=="string"?p:l.name,J=l.id!==h;return`
          <div class="groupRow">
            <input data-act="groupName" data-id="${f(l.id)}" value="${f(E)}" aria-label="分组名" />
            <button class="btn" data-act="saveGroup" data-id="${f(l.id)}">保存</button>
            ${J?`<button class="btn danger" data-act="delGroup" data-id="${f(l.id)}">删除</button>`:'<button class="btn" disabled title="默认分组不可删除">锁定</button>'}
          </div>
        `}).join(""));let G=document.querySelector('input[data-act="addTitle"]'),A=document.querySelector('input[data-act="addUrl"]'),U=document.querySelector('input[data-act="newGroupName"]');G instanceof HTMLInputElement&&(G.value=t.addTitle),A instanceof HTMLInputElement&&(A.value=t.addUrl),U instanceof HTMLInputElement&&(U.value=t.newGroupName);let L=!!String(t.editId||"").trim(),B=document.querySelector('[data-role="addModal"]'),q=document.querySelector('[data-role="addModalTitle"]'),N=document.querySelector('[data-role="addConfirmBtn"]');B instanceof HTMLElement&&B.setAttribute("aria-label",L?"编辑收藏":"新增收藏"),q instanceof HTMLElement&&(q.textContent=L?"编辑收藏":"新增收藏"),N instanceof HTMLButtonElement&&(N.textContent=L?"保存":"添加");let w=document.querySelector('img[data-role="addIconImg"]');if(w instanceof HTMLImageElement){w.setAttribute("referrerpolicy","no-referrer");let l=String(t.addIconUrl||"").trim(),p=w.closest(".siteIcon");l?(w.src=l,p instanceof HTMLElement&&p.classList.remove("err")):(w.removeAttribute("src"),p instanceof HTMLElement&&(p.classList.remove("ok"),p.classList.remove("err")))}}async function Y(){X(),c();try{await D()}catch(e){t.loading=!1,c(),s(String((e==null?void 0:e.message)||e||"加载失败"))}}Y()})();})();

//# sourceURL=fast-window-plugin:bookmarks/index.js

