const COLUMNS = [
  'Novo caso', 'Em análise', 'Documentos pendentes', 'Processo iniciado',
  'Petição em elaboração', 'Petição protocolada', 'Aguardando manifestação',
  'Aguardando audiência', 'Aguardando decisão', 'Recurso', 'Finalizado', 'Arquivado'
];

const board = document.getElementById('kanbanBoard');

function getTagClass(tag) {
  if (tag === 'Crítico') return 'tag-critico';
  if (tag === 'Alta') return 'tag-alta';
  if (tag === 'Baixa') return 'tag-baixa';
  return 'tag-normal';
}

async function loadCases() {
  const res = await fetch('/api/crm/cases');
  const json = await res.json();
  if (json.success) renderBoard(json.data);
}

function renderBoard(cases) {
  board.innerHTML = '';
  
  COLUMNS.forEach(status => {
    const col = document.createElement('div');
    col.className = 'kanban-column';
    col.innerHTML = `<h3>${status}</h3>`;
    
    const colCases = cases.filter(c => c.status === status);
    
    colCases.forEach(c => {
      const card = document.createElement('div');
      card.className = 'kanban-card';
      
      let options = '';
      COLUMNS.forEach(opt => {
        const selected = opt === status ? 'selected' : '';
        options += `<option value="${opt}" ${selected}>${opt}</option>`;
      });

      card.innerHTML = `
        <div class="card-title">${c.client_name || 'Sem nome'}</div>
        <div class="card-phone">${c.phone}</div>
        <span class="tag ${getTagClass(c.urgency_tag)}">${c.urgency_tag || 'Normal'}</span>
        <select class="select-status" onchange="updateStatus('${c.id}', this.value)">
           ${options}
        </select>
      `;
      col.appendChild(card);
    });
    
    board.appendChild(col);
  });
}

window.updateStatus = async function(id, newStatus) {
  await fetch('/api/crm/cases/' + id + '/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus })
  });
  loadCases(); // Recarrega
};

// Start
loadCases();
