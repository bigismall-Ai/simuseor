
(function(){
  var root=document.documentElement;
  var saved=localStorage.getItem('trb-theme');
  if(saved){root.setAttribute('data-theme',saved);}
  document.getElementById('themeBtn').onclick=function(){
    var cur=root.getAttribute('data-theme')==='dark'?'light':'dark';
    root.setAttribute('data-theme',cur);localStorage.setItem('trb-theme',cur);
  };
  // 导航高亮
  var links=[].slice.call(document.querySelectorAll('.nav a'));
  var secs=links.map(function(a){return document.querySelector(a.getAttribute('href'));}).filter(Boolean);
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){
      es.forEach(function(e){
        if(e.isIntersecting){
          links.forEach(function(l){l.classList.toggle('active',l.getAttribute('href')==='#'+e.target.id);});
        }
      });
    },{rootMargin:'-20% 0px -70% 0px'});
    secs.forEach(function(s){io.observe(s);});
  }
  // 矩阵筛选 + 详情
  var q=document.getElementById('mFilter'), onlyTodo=document.getElementById('onlyTodo');
  var rows=[].slice.call(document.querySelectorAll('#matrix tbody tr'));
  function apply(){
    var v=(q.value||'').trim();
    rows.forEach(function(r){
      var ok=!v || r.dataset.cat.indexOf(v)>=0;
      if(onlyTodo && onlyTodo.checked){
        var hasTodo=[].slice.call(r.querySelectorAll('td')).some(function(t){return t.dataset.val==='todo';});
        ok=ok && hasTodo;
      }
      r.style.display=ok?'':'none';
    });
  }
  if(q){q.addEventListener('input',apply);}
  if(onlyTodo){onlyTodo.addEventListener('change',apply);}
  var info=document.getElementById('cellInfo');
  [].slice.call(document.querySelectorAll('#matrix td.cell')).forEach(function(td){
    function show(){
      info.textContent=td.dataset.cat+' × '+td.dataset.par+'：'+td.querySelector('.lbl').textContent+' — '+td.dataset.note;
    }
    td.addEventListener('click',show);
    td.addEventListener('focus',show);
  });
})();
