// Главное приложение
class RoadEditor {
    constructor() {
        this.project = null;
        this.selectedLane = null;
        this.canvas = document.getElementById('canvas');
        this.statusText = document.getElementById('status-text');
        this.selectedLaneText = document.getElementById('selected-lane');
        
        this.init();
    }
    
    async init() {
        this.showStatus('Загрузка проекта...');
        await this.loadProject();
        this.setupEventListeners();
        this.render();
        this.showStatus('Готов к работе');
    }
    
    // API методы
    async loadProject() {
        try {
            const response = await fetch('/api/project');
            this.project = await response.json();
        } catch (error) {
            console.error('Ошибка загрузки проекта:', error);
            this.showModal('Ошибка загрузки проекта');
        }
    }
    
    async saveProject() {
        try {
            this.showStatus('Сохранение...');
            const response = await fetch('/api/project', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.project)
            });
            const result = await response.json();
            
            if (result.success) {
                this.showStatus('Проект сохранен');
            } else {
                this.showModal('Ошибка сохранения: ' + result.error);
            }
        } catch (error) {
            console.error('Ошибка сохранения:', error);
            this.showModal('Ошибка сохранения проекта');
        }
    }
    
    async addRoad() {
        try {
            const response = await fetch('/api/road', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const result = await response.json();
            
            if (result.success) {
                this.project.roads.push(result.road);
                this.render();
                this.showStatus('Дорога добавлена');
            }
        } catch (error) {
            console.error('Ошибка добавления дороги:', error);
        }
    }
    
    async modifyLane(action) {
        try {
            const response = await fetch('/api/lane', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action })
            });
            const result = await response.json();
            
            if (result.success) {
                // Обновляем локальные данные
                const roadIndex = this.project.roads.findIndex(r => r.id === result.road.id);
                if (roadIndex !== -1) {
                    this.project.roads[roadIndex] = result.road;
                }
                this.render();
                
                const actions = {
                    'add_left': 'Полоса добавлена слева',
                    'add_right': 'Полоса добавлена справа',
                    'remove': 'Полоса удалена'
                };
                this.showStatus(actions[action] || 'Полоса изменена');
            }
        } catch (error) {
            console.error('Ошибка изменения полосы:', error);
        }
    }
    
    async updateLane(laneId, updates) {
        try {
            const response = await fetch(`/api/lane/${laneId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            const result = await response.json();
            
            if (result.success) {
                // Обновляем локальные данные
                for (let road of this.project.roads) {
                    const laneIndex = road.lanes.findIndex(l => l.id === laneId);
                    if (laneIndex !== -1) {
                        road.lanes[laneIndex] = result.lane;
                        break;
                    }
                }
                this.render();
                this.showStatus('Полоса обновлена');
            }
        } catch (error) {
            console.error('Ошибка обновления полосы:', error);
        }
    }
    
    // Обработчики событий
    setupEventListeners() {
        // Кнопки управления дорогами и полосами
        document.getElementById('add-road').addEventListener('click', () => this.addRoad());
        document.getElementById('add-lane-left').addEventListener('click', () => this.modifyLane('add_left'));
        document.getElementById('add-lane-right').addEventListener('click', () => this.modifyLane('add_right'));
        document.getElementById('remove-lane').addEventListener('click', () => this.modifyLane('remove'));
        
        // Кнопки типов полос
        document.getElementById('type-general').addEventListener('click', () => this.setLaneType('general'));
        document.getElementById('type-bus').addEventListener('click', () => this.setLaneType('bus'));
        document.getElementById('type-bike').addEventListener('click', () => this.setLaneType('bike'));
        document.getElementById('type-parking').addEventListener('click', () => this.setLaneType('parking'));
        
        // Кнопки направлений
        document.getElementById('turn-left').addEventListener('click', () => this.setLaneTurn(['left']));
        document.getElementById('turn-through').addEventListener('click', () => this.setLaneTurn(['through']));
        document.getElementById('turn-right').addEventListener('click', () => this.setLaneTurn(['right']));
        document.getElementById('turn-through-right').addEventListener('click', () => this.setLaneTurn(['through', 'right']));
        document.getElementById('turn-through-left').addEventListener('click', () => this.setLaneTurn(['through', 'left']));
        document.getElementById('turn-uturn').addEventListener('click', () => this.setLaneTurn(['uturn']));
        
        // Кнопки экспорта и сохранения
        document.getElementById('export').addEventListener('click', () => this.exportProject());
        document.getElementById('save').addEventListener('click', () => this.saveProject());
        
        // Клик по холсту
        this.canvas.addEventListener('click', (e) => this.onCanvasClick(e));
        
        // Модальное окно
        document.querySelector('.close').addEventListener('click', () => this.hideModal());
        document.getElementById('modal').addEventListener('click', (e) => {
            if (e.target.id === 'modal') this.hideModal();
        });
    }
    
    setLaneType(type) {
        if (this.selectedLane) {
            this.updateLane(this.selectedLane.id, { type });
        } else {
            this.showStatus('Выберите полосу для изменения типа');
        }
    }
    
    setLaneTurn(turns) {
        if (this.selectedLane) {
            this.updateLane(this.selectedLane.id, { turns });
        } else {
            this.showStatus('Выберите полосу для изменения направления');
        }
    }
    
    onCanvasClick(e) {
        const target = e.target;
        
        if (target.classList.contains('lane-line')) {
            const laneId = target.dataset.laneId;
            this.selectLane(laneId);
        } else {
            this.deselectLane();
        }
    }
    
    selectLane(laneId) {
        // Найти полосу в проекте
        let foundLane = null;
        for (let road of this.project.roads) {
            foundLane = road.lanes.find(lane => lane.id === laneId);
            if (foundLane) break;
        }
        
        this.selectedLane = foundLane;
        this.updateSelection();
        
        if (foundLane) {
            this.selectedLaneText.textContent = `Полоса: ${foundLane.type} (${foundLane.turns.join(', ')})`;
        }
    }
    
    deselectLane() {
        this.selectedLane = null;
        this.selectedLaneText.textContent = '';
        this.updateSelection();
    }
    
    updateSelection() {
        // Обновить стили выбранной полосы
        const lanes = this.canvas.querySelectorAll('.lane-line');
        lanes.forEach(lane => {
            if (this.selectedLane && lane.dataset.laneId === this.selectedLane.id) {
                lane.classList.add('selected');
            } else {
                lane.classList.remove('selected');
            }
        });
    }
    
    // Отрисовка
    render() {
        if (!this.project) return;
        
        // Очистить холст
        this.canvas.innerHTML = '';
        
        // Отрисовать каждую дорогу
        this.project.roads.forEach(road => {
            this.renderRoad(road);
        });
        
        this.updateSelection();
    }
    
    renderRoad(road) {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'road-group');
        
        // Отрисовка осевой линии
        const axisPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        axisPath.setAttribute('d', Geometry.pointsToPath(road.points));
        axisPath.setAttribute('class', 'road-axis');
        group.appendChild(axisPath);
        
        // Получить середину дороги для размещения иконок
        const { p: midPoint, angleRad } = Geometry.polylineMidpoint(road.points);
        
        // Отрисовка полос
        const lanesCount = road.lanes.length;
        road.lanes.forEach((lane, index) => {
            const offset = (index - (lanesCount - 1) / 2) * Geometry.LANE_WIDTH_PX;
            const lanePoints = Geometry.offsetPolyline(road.points, offset);
            
            // Линия полосы
            const lanePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            lanePath.setAttribute('d', Geometry.pointsToPath(lanePoints));
            lanePath.setAttribute('class', `lane-line ${lane.type}`);
            lanePath.setAttribute('data-lane-id', lane.id);
            group.appendChild(lanePath);
            
            // Иконка полосы
            const iconContainer = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
            iconContainer.setAttribute('x', midPoint.x - 8 + offset);
            iconContainer.setAttribute('y', midPoint.y - 8);
            iconContainer.setAttribute('width', '16');
            iconContainer.setAttribute('height', '16');
            iconContainer.setAttribute('class', 'lane-icon');
            
            const iconDiv = document.createElement('div');
            iconDiv.style.cssText = 'display: flex; align-items: center; justify-content: center; pointer-events: none;';
            
            const icon = Icons.getLaneIcon(lane, angleRad);
            iconDiv.appendChild(icon);
            iconContainer.appendChild(iconDiv);
            
            group.appendChild(iconContainer);
        });
        
        this.canvas.appendChild(group);
    }
    
    // UI утилиты
    showStatus(message, duration = 3000) {
        this.statusText.textContent = message;
        
        if (duration > 0) {
            setTimeout(() => {
                this.statusText.textContent = 'Готов к работе';
            }, duration);
        }
    }
    
    showModal(message) {
        document.getElementById('modal-text').textContent = message;
        document.getElementById('modal').classList.remove('hidden');
    }
    
    hideModal() {
        document.getElementById('modal').classList.add('hidden');
    }
    
    exportProject() {
        window.open('/api/project/export', '_blank');
        this.showStatus('Проект экспортирован');
    }
}

// Запуск приложения
document.addEventListener('DOMContentLoaded', () => {
    new RoadEditor();
});