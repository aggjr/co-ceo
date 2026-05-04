/**
 * STOCKSPIN — Core Application Logic (V2.2 - EVOLVED)
 * Focus: High Fidelity Map, Interactive Drag & Dynamic History.
 */

const PALETTE = {
    gold: '#DAB177',
    goldBright: '#f5cf96',
    emerald: '#10B981',
    ruby: '#F43F5E',
    white: '#F8FAFC',
    textDim: '#94A3B8',
    navyBg: 'radial-gradient(circle at 50% 50%, #1a3a6d 0%, #050d1a 100%)',
    navySolid: '#050d1a'
};

const APP = {
    canvas: null,
    ctx: null,
    units: [],
    factoryDistanceKM: "12",
    distanceLabels: [],
    distanceLabelOffsets: {},
    
    // Interaction state
    draggingUnit: null,
    draggingLabel: null,
    draggingDistanceLabel: null,
    dragOffset: { x: 0, y: 0 },
    lastClickTime: 0,
    selectedUnit: null,
    contextTarget: null,
    
    // History state
    undoStack: [],
    redoStack: [],
    
    init() {
        console.log("STOCKSPIN: Restaurando V2.2...");
        this.setupCanvas();
        this.createSchematicTopology();
        this.applySavedLayout();
        this.setupInteractions();
        
        // Iniciar loop de render
        this.render();
        
        // Bind UI
        this.bindEvents();
        
        this.log("Motor STOCKSPIN restaurado (V2.2).", "sys");
    },

    setupCanvas() {
        this.canvas = document.getElementById('map-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();
        window.addEventListener('resize', () => {
            this.resizeCanvas();
        });
    },

    resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.parentNode.getBoundingClientRect();
        
        // Garantir que não temos escala cumulativa
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // Reset + Scale
        
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
    },

    setupInteractions() {
        if (!this.canvas) return;

        this.canvas.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            const m = this.getMousePos(e);

            // 1) Distâncias KM (permitir arrastar e reposicionar)
            const distanceTarget = this.findDistanceLabelTarget(m);
            if (distanceTarget) {
                this.pushUndo();
                this.draggingDistanceLabel = distanceTarget;
                this.dragOffset.x = (distanceTarget.offsetX || 0) - (m.x - distanceTarget.anchorX);
                this.dragOffset.y = (distanceTarget.offsetY || 0) - (m.y - distanceTarget.anchorY);
                this.canvas.setPointerCapture(e.pointerId);
                return;
            }

            // 2. Procurar clique no TEXTO primeiro (prioritário para movimentação fina)
            const labelTarget = this.units.find(u => {
                const labelY = u.y + (u.type === 'cd' ? 60 : 48) + (u.labelOffsetY || 0);
                const labelX = u.x + (u.labelOffsetX || 0);
                const dx = labelX - m.x;
                const dy = labelY - m.y;
                return Math.abs(dx) < 60 && Math.abs(dy) < 15; // Hit box dos nomes
            });

            if (labelTarget) {
                this.pushUndo();
                this.draggingLabel = labelTarget;
                this.dragOffset.x = (labelTarget.labelOffsetX || 0) - (m.x - labelTarget.x);
                this.dragOffset.y = (labelTarget.labelOffsetY || 0) - (m.y - labelTarget.y);
                this.canvas.setPointerCapture(e.pointerId);
                return;
            }

            // 3. Procurar clique no ÍCONE
            const unitTarget = this.units.find(u => {
                const dx = u.x - m.x;
                const dy = u.y - m.y;
                return Math.sqrt(dx*dx + dy*dy) < (u.type === 'cd' ? 50 : 40);
            });

            if (unitTarget) {
                this.pushUndo();
                this.selectedUnit = unitTarget; // Selecionar ao clicar
                this.draggingUnit = unitTarget;
                this.dragOffset.x = unitTarget.x - m.x;
                this.dragOffset.y = unitTarget.y - m.y;
                this.canvas.setPointerCapture(e.pointerId);
            } else {
                this.selectedUnit = null; // Deselecionar se clicar no vazio
            }
            this.hideContextMenu();
        });

        this.canvas.addEventListener('pointermove', (e) => {
            const m = this.getMousePos(e);
            if (this.draggingDistanceLabel) {
                const key = this.draggingDistanceLabel.key;
                if (key) {
                    this.distanceLabelOffsets[key] = {
                        x: m.x - this.draggingDistanceLabel.anchorX + this.dragOffset.x,
                        y: m.y - this.draggingDistanceLabel.anchorY + this.dragOffset.y
                    };
                }
            } else if (this.draggingUnit) {
                this.draggingUnit.x = m.x + this.dragOffset.x;
                this.draggingUnit.y = m.y + this.dragOffset.y;
            } else if (this.draggingLabel) {
                this.draggingLabel.labelOffsetX = m.x - this.draggingLabel.x + this.dragOffset.x;
                this.draggingLabel.labelOffsetY = m.y - this.draggingLabel.y + this.dragOffset.y;
            }
        });

        this.canvas.addEventListener('pointerup', (e) => {
            if (this.draggingUnit || this.draggingLabel || this.draggingDistanceLabel) {
                this.draggingUnit = null;
                this.draggingLabel = null;
                this.draggingDistanceLabel = null;
                this.saveLayout();
                this.canvas.releasePointerCapture(e.pointerId);
            }

            // DETECTOR DE CLIQUE DUPLO MANUAL (Robustez absoluta)
            const currentTime = new Date().getTime();
            const tapLength = currentTime - this.lastClickTime;
            if (tapLength < 300 && tapLength > 0) {
                this.handleManualDblClick(this.getMousePos(e));
                this.lastClickTime = 0; // Reset para evitar triplo clique
            } else {
                this.lastClickTime = currentTime;
            }
        });

        // CURSOR HAND NO HOVER
        this.canvas.addEventListener('pointermove', (e) => {
            if (this.draggingUnit || this.draggingLabel || this.draggingDistanceLabel) return;
            const m = this.getMousePos(e);
            const overUnit = this.units.find(u => {
                const dx = u.x - m.x;
                const dy = u.y - m.y;
                return Math.sqrt(dx*dx + dy*dy) < (u.type === 'cd' ? 60 : 50);
            });
            const overLabel = this.units.find(u => {
                const lx = u.x + (u.labelOffsetX || 0);
                const ly = u.y + (u.type === 'cd' ? 60 : 48) + (u.labelOffsetY || 0);
                return Math.abs(lx - m.x) < 60 && Math.abs(ly - m.y) < 15;
            });
            const overDistance = this.findDistanceLabelTarget(m);
            this.canvas.style.cursor = (overUnit || overLabel || overDistance) ? 'pointer' : 'default';
        });

        // (Evento dblclick nativo removido por instabilidade em Canvas com PointerCapture)
        
        // TECLA F2 PARA RENOMEAR
        window.addEventListener('keydown', (e) => {
            if (e.key === 'F2' && this.selectedUnit) {
                this.triggerRename(this.selectedUnit);
            }
        });

        // BOTÃO DIREITO - MENU DE CONTEXTO
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const m = this.getMousePos(e);
            const target = this.findTarget(m);

            if (target) {
                this.showContextMenu(e.clientX, e.clientY, target);
            } else {
                this.hideContextMenu();
            }
        });

        // Fechar menu ao clicar fora
        window.addEventListener('click', () => this.hideContextMenu());
    },

    findTarget(m) {
        return this.units.find(u => {
            const dxUnit = u.x - m.x;
            const dyUnit = u.y - m.y;
            const hitIcon = Math.sqrt(dxUnit*dxUnit + dyUnit*dyUnit) < (u.type === 'cd' ? 65 : 55);
            const lx = u.x + (u.labelOffsetX || 0);
            const ly = u.y + (u.type === 'cd' ? 60 : 48) + (u.labelOffsetY || 0);
            const hitLabel = Math.abs(lx - m.x) < 100 && Math.abs(ly - m.y) < 30;
            return hitIcon || hitLabel;
        });
    },

    showContextMenu(x, y, unit) {
        const menu = document.getElementById('custom-context-menu');
        if (!menu) return;
        this.contextTarget = unit;
        menu.style.display = 'block';
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
    },

    hideContextMenu() {
        const menu = document.getElementById('custom-context-menu');
        if (menu) menu.style.display = 'none';
    },

    triggerRename(target) {
        if (!target) return;
        const newName = prompt("Novo nome para a unidade:", target.name);
        if (newName && newName.trim() !== "") {
            this.pushUndo();
            target.name = newName.trim();
            this.saveLayout();
            this.render();
        }
    },

    handleManualDblClick(m) {
        const distanceTarget = this.findDistanceLabelTarget(m);
        if (distanceTarget) {
            this.editDistance(distanceTarget);
            return;
        }
        const target = this.findTarget(m);
        if (target) this.triggerRename(target);
    },

    findDistanceLabelTarget(m) {
        if (!Array.isArray(this.distanceLabels)) return null;
        return this.distanceLabels.find((d) => {
            return Math.abs(d.x - m.x) < 38 && Math.abs(d.y - m.y) < 14;
        });
    },

    editDistance(target) {
        if (!target) return;
        const current = String(target.value || "").replace(" km", "").trim();
        const next = prompt('Distância em KM (formato "XX" ou "XX,XX"):', current);
        if (next == null) return;
        const value = String(next).trim();
        if (!/^\d{2}(,\d{2})?$/.test(value)) {
            alert('Formato inválido. Use "XX" ou "XX,XX".');
            return;
        }
        this.pushUndo();
        if (target.kind === "factory-cd") {
            this.factoryDistanceKM = value;
        } else if (target.unitId) {
            const u = this.units.find((x) => x.id === target.unitId);
            if (u) u.distanceKM = value;
        }
        this.saveLayout();
    },

    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    },

    createSchematicTopology() {
        const defaultLayout = [
            {"id":"factory","x":119.5,"y":287.5,"name":"Fábrica SARON","icon":"🏭","type":"factory","pulsing":true,"stock":500},
            {"id":"cd","x":260.1,"y":288.3,"name":"CD SARON","icon":"📦","type":"cd","pulsing":true,"distanceKM":12,"stock":1500},
            {"id":"store-0","x":618.5,"y":65.0,"name":"Loja Eldorado","icon":"🏪","type":"store","lx":0,"ly":-83.2},
            {"id":"store-1","x":263.8,"y":174.3,"name":"Venda Web","icon":"🏪","type":"store","lx":-1.6,"ly":-81.6},
            {"id":"store-babita","x":256.4,"y":402.3,"name":"Babita","icon":"🏪","type":"store","lx":-0.8,"ly":13.6,"distanceKM":0},
            {"id":"store-2","x":758.1,"y":121.2,"name":"Centro (Betim)","icon":"🏪","type":"store","lx":3.2,"ly":-82.4},
            {"id":"store-3","x":839.7,"y":207.9,"name":"Barreiro","icon":"🏪","type":"store","lx":0.8,"ly":-80},
            {"id":"store-4","x":838.7,"y":308.0,"name":"Centro (Guaranis)","icon":"🏪","type":"store","lx":0,"ly":-80},
            {"id":"store-5","x":838.3,"y":391.5,"name":"Centro (Goitacazes)","icon":"🏪","type":"store","lx":0,"ly":-12.8},
            {"id":"store-6","x":722.0,"y":476.0,"name":"Centro (Tupis)","icon":"🏪","type":"store","lx":-0.8,"ly":-10.4},
            {"id":"store-7","x":549.1,"y":507.7,"name":"Venda Nova","icon":"🏪","type":"store","lx":-0.8,"ly":-13.6}
        ];

        this.units = defaultLayout.map(d => ({
            ...d,
            lx: d.lx || 0,
            ly: d.ly || 0,
            initialX: d.x,
            initialY: d.y,
            initialName: d.name,
            labelOffsetX: d.lx || 0,
            labelOffsetY: d.ly || 0,
            stock: d.stock || this.generateMockStock(45, 1)
        }));
    },

    addUnit(config) {
        const unit = { ...config, initialX: config.x, initialY: config.y };
        this.units.push(unit);
    },

    saveLayout() {
        const layout = this.units.map(u => ({ 
            id: u.id, x: u.x, y: u.y, name: u.name,
            lx: u.labelOffsetX || 0, ly: u.labelOffsetY || 0,
            distanceKM: u.distanceKM != null ? String(u.distanceKM) : null
        }));
        localStorage.setItem('stockspin_layout', JSON.stringify({
            units: layout,
            factoryDistanceKM: this.factoryDistanceKM,
            distanceLabelOffsets: this.distanceLabelOffsets
        }));
    },

    applySavedLayout() {
        const saved = localStorage.getItem('stockspin_layout');
        if (!saved) return;
        try {
            const parsed = JSON.parse(saved);
            const layout = Array.isArray(parsed) ? parsed : (parsed.units || []);
            if (!Array.isArray(parsed) && parsed.factoryDistanceKM) {
                this.factoryDistanceKM = String(parsed.factoryDistanceKM);
            }
            if (!Array.isArray(parsed) && parsed.distanceLabelOffsets && typeof parsed.distanceLabelOffsets === "object") {
                this.distanceLabelOffsets = parsed.distanceLabelOffsets;
            }
            layout.forEach(item => {
                const unit = this.units.find(u => u.id === item.id);
                if (unit) { 
                    unit.x = item.x; unit.y = item.y; 
                    unit.name = item.name || unit.name;
                    unit.labelOffsetX = item.lx || 0;
                    unit.labelOffsetY = item.ly || 0;
                    if (item.distanceKM != null) unit.distanceKM = String(item.distanceKM);
                }
            });
        } catch (e) {
            console.error("Falha ao recuperar layout:", e);
        }
    },

    resetLayout() {
        this.pushUndo();
        localStorage.removeItem('stockspin_layout');
        this.units.forEach(u => {
            u.x = u.initialX;
            u.y = u.initialY;
            u.name = u.initialName;
            u.labelOffsetX = u.lx || 0;
            u.labelOffsetY = u.ly || 0;
        });
        this.factoryDistanceKM = "12";
        this.distanceLabelOffsets = {};
    },

    // HISTÓRICO (UNDO/REDO)
    pushUndo() {
        const snapshot = this.units.map(u => ({ 
            id: u.id, x: u.x, y: u.y, name: u.name,
            lx: u.labelOffsetX || 0, ly: u.labelOffsetY || 0,
            distanceKM: u.distanceKM != null ? String(u.distanceKM) : null
        }));
        this.undoStack.push({
            units: snapshot,
            factoryDistanceKM: this.factoryDistanceKM,
            distanceLabelOffsets: { ...this.distanceLabelOffsets }
        });
        if (this.undoStack.length > 30) this.undoStack.shift();
        this.redoStack = []; 
    },

    getSnapshot() {
        return {
            units: this.units.map(u => ({ 
            id: u.id, x: u.x, y: u.y, name: u.name,
            lx: u.labelOffsetX || 0, ly: u.labelOffsetY || 0,
            distanceKM: u.distanceKM != null ? String(u.distanceKM) : null
            })),
            factoryDistanceKM: this.factoryDistanceKM,
            distanceLabelOffsets: { ...this.distanceLabelOffsets }
        };
    },

    applySnapshot(snapshot) {
        const units = Array.isArray(snapshot) ? snapshot : (snapshot.units || []);
        units.forEach(item => {
            const unit = this.units.find(u => u.id === item.id);
            if (unit) { 
                unit.x = item.x; unit.y = item.y; 
                unit.name = item.name;
                unit.labelOffsetX = item.lx;
                unit.labelOffsetY = item.ly;
                if (item.distanceKM != null) unit.distanceKM = String(item.distanceKM);
            }
        });
        if (!Array.isArray(snapshot) && snapshot.factoryDistanceKM) {
            this.factoryDistanceKM = String(snapshot.factoryDistanceKM);
        }
        if (!Array.isArray(snapshot) && snapshot.distanceLabelOffsets && typeof snapshot.distanceLabelOffsets === "object") {
            this.distanceLabelOffsets = { ...snapshot.distanceLabelOffsets };
        }
        this.saveLayout();
    },

    undo() {
        if (this.undoStack.length === 0) return;
        const current = this.getSnapshot();
        this.redoStack.push(current);
        const prev = this.undoStack.pop();
        this.applySnapshot(prev);
    },

    redo() {
        if (this.redoStack.length === 0) return;
        const current = this.getSnapshot();
        this.undoStack.push(current);
        const next = this.redoStack.pop();
        this.applySnapshot(next);
    },

    generateMockStock(avgQty, showroom) {
        const stockData = {};
        const cats = ['cama', 'cortinas', 'decor', 'tapetes'];
        cats.forEach(cid => {
            const qty = Math.floor(avgQty * (0.5 + Math.random()));
            stockData[cid] = { total: qty, available: qty - (showroom || 0) };
        });
        return stockData;
    },

    render() {
        if (!this.ctx) return;
        const ctx = this.ctx;
        const W = this.canvas.width / (window.devicePixelRatio || 1);
        const H = this.canvas.height / (window.devicePixelRatio || 1);

        ctx.clearRect(0, 0, W, H);
        
        // Fundo
        const grad = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, W);
        grad.addColorStop(0, '#1a3a6d'); grad.addColorStop(1, '#050d1a');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        this.drawBackgroundGrid(W, H);
        this.distanceLabels = [];
        
        // Setas de Fluxo
        const factory = this.units.find(u => u.type === 'factory');
        const cd = this.units.find(u => u.type === 'cd');
        if (factory && cd) {
            this.drawArrow(factory.x, factory.y, cd.x, cd.y, `${this.factoryDistanceKM} km`, {
                kind: "factory-cd",
                key: "factory-cd",
                value: this.factoryDistanceKM
            });
            this.units.forEach(u => {
                if (u.type === 'store') {
                    const value = u.distanceKM != null ? String(u.distanceKM) : "00";
                    this.drawArrow(cd.x, cd.y, u.x, u.y, `${value} km`, {
                        kind: "cd-store",
                        key: `cd-${u.id}`,
                        unitId: u.id,
                        value
                    });
                }
            });
        }

        // Unidades
        this.units.forEach(u => this.drawUnitIcon(u));

        // Atualizar KPIs Simulados
        this.updateKPIs();

        requestAnimationFrame(() => this.render());
    },

    drawBackgroundGrid(W, H) {
        const ctx = this.ctx;
        ctx.save();
        // Grade quase invisível: só orientação espacial, sem competir com setas/nós
        ctx.strokeStyle = 'rgba(218, 177, 119, 0.018)';
        ctx.lineWidth = 0.55;
        const step = 60;
        for (let x = 0; x < W; x += step) {
            ctx.beginPath();
            ctx.moveTo(x + 0.5, 0);
            ctx.lineTo(x + 0.5, H);
            ctx.stroke();
        }
        for (let y = 0; y < H; y += step) {
            ctx.beginPath();
            ctx.moveTo(0, y + 0.5);
            ctx.lineTo(W, y + 0.5);
            ctx.stroke();
        }
        ctx.restore();
    },

    drawArrow(x1, y1, x2, y2, label, meta = null) {
        const ctx = this.ctx;
        const headlen = 10;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        
        // PADDING para não cruzar o ícone (início e fim)
        const padStart = 35;
        const padEnd = 45;
        
        const startX = x1 + padStart * Math.cos(angle);
        const startY = y1 + padStart * Math.sin(angle);
        const endX = x2 - padEnd * Math.cos(angle);
        const endY = y2 - padEnd * Math.sin(angle);

        ctx.save();
        ctx.strokeStyle = 'rgba(218, 177, 119, 0.35)'; // Um pouco mais visível
        ctx.lineWidth = 1.6;
        
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - headlen * Math.cos(angle - Math.PI / 6), endY - headlen * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - headlen * Math.cos(angle + Math.PI / 6), endY - headlen * Math.sin(angle + Math.PI / 6));
        ctx.stroke();

        if (label) {
            const anchorX = (startX + endX) / 2;
            const anchorY = (startY + endY) / 2 - 12;
            const key = meta && meta.key ? meta.key : null;
            const off = key && this.distanceLabelOffsets[key] ? this.distanceLabelOffsets[key] : { x: 0, y: 0 };
            const lx = anchorX + (off.x || 0);
            const ly = anchorY + (off.y || 0);
            ctx.fillStyle = PALETTE.gold;
            ctx.font = '600 10px Montserrat';
            ctx.textAlign = 'center';
            ctx.fillText(label, lx, ly);
            this.distanceLabels.push({
                ...(meta || {}),
                key,
                x: lx,
                y: ly,
                anchorX,
                anchorY,
                offsetX: off.x || 0,
                offsetY: off.y || 0
            });
        }
        ctx.restore();
    },

    drawUnitIcon(u) {
        const ctx = this.ctx;
        const size = u.type === 'cd' ? 45 : 35;
        
        ctx.save();
        if (u.pulsing) { ctx.shadowBlur = 10; ctx.shadowColor = PALETTE.gold; }

        ctx.fillStyle = 'rgba(10, 28, 61, 0.95)';
        ctx.strokeStyle = PALETTE.gold;
        ctx.lineWidth = 2;

        if (u.type === 'factory') {
            this.drawPolygon(u.x, u.y, size, 6);
        } else if (u.type === 'cd') {
            this.drawPolygon(u.x, u.y, size, 8);
        } else {
            ctx.beginPath();
            // Retângulo arredondado para as lojas
            const rw = size * 1.8;
            const rh = size * 1.2;
            ctx.roundRect(u.x - rw/2, u.y - rh/2, rw, rh, 5);
        }

        if (u.type === 'store') {
            ctx.fillStyle = 'rgba(218, 177, 119, 0.15)'; // Estilo vidro dourado
            ctx.fill();
        } else {
            ctx.fill();
        }
        ctx.stroke();

        // --- CORREÇÃO DE VISIBILIDADE DOS ÍCONES ---
        ctx.shadowBlur = 0;
        ctx.fillStyle = PALETTE.gold; // Garantir que o ícone tenha cor de contraste
        ctx.font = `${size/1.5}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(u.icon, u.x, u.y);

        // Nomes das unidades com melhor legibilidade e MENOR DISTÂNCIA (Editável e Móvel)
        ctx.fillStyle = PALETTE.white;
        ctx.font = '600 10px Montserrat'; 
        const baseOffsetY = (u.type === 'cd' ? 60 : 48);
        ctx.fillText(u.name, u.x + (u.labelOffsetX || 0), u.y + baseOffsetY + (u.labelOffsetY || 0));
        
        ctx.restore();
    },

    drawPolygon(x, y, radius, sides) {
        this.ctx.beginPath();
        for (let i = 0; i < sides; i++) {
            const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
            const px = x + radius * Math.cos(angle);
            const py = y + radius * Math.sin(angle);
            if (i === 0) this.ctx.moveTo(px, py);
            else this.ctx.lineTo(px, py);
        }
        this.ctx.closePath();
    },

    updateKPIs() {
        const el = document.querySelector('#kpi-availability .kpi-value');
        if (el) el.textContent = '84.2%';
    },

    bindEvents() {
        document.querySelectorAll('.cat-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.log(`Filtrando: ${btn.textContent}`, "sys");
            };
        });

        const resetBtn = document.getElementById('btn-reset-layout');
        if (resetBtn) resetBtn.onclick = () => this.resetLayout();

        const undoBtn = document.getElementById('btn-undo');
        if (undoBtn) undoBtn.onclick = () => this.undo();

        const redoBtn = document.getElementById('btn-redo');
        if (redoBtn) redoBtn.onclick = () => this.redo();

        const ctxRename = document.getElementById('ctx-rename');
        if (ctxRename) ctxRename.onclick = () => {
            this.triggerRename(this.contextTarget);
            this.hideContextMenu();
        };
    },

    log(msg, type) {
        // Log desativado do mapa a pedido do usuário.
        console.log(`[STOCKSPIN] ${msg}`);
    }
};

window.onload = () => APP.init();
