// Глобальные переменные
let map;
let currentRoad = null;
let currentWayData = null;
let roadsLayer = null;

// Инициализация карты
function initMap() {
    map = L.map('map').setView([55.7558, 37.6173], 10);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    roadsLayer = L.layerGroup().addTo(map);
    
    // Автоматически загружаем дороги при изменении области просмотра
    map.on('moveend', function() {
        if (map.getZoom() >= 15) { // Загружаем только при достаточном зуме
            loadRoadsInView();
        }
    });
}

// Поиск локации
function searchLocation() {
    const query = document.getElementById('searchInput').value;
    if (!query) return;

    showToast('Поиск...', 'info');

    fetch('/api/roads/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success && data.results.length > 0) {
            const result = data.results[0];
            map.setView([result.lat, result.lon], 16); // Увеличиваем зум
            showToast(`Найдено: ${result.name}`, 'success');
            
            // Автоматически загружаем дороги после поиска
            setTimeout(() => {
                loadRoadsInView();
            }, 500);
        } else {
            showToast('Локация не найдена', 'warning');
        }
    })
    .catch(error => {
        console.error('Ошибка поиска:', error);
        showToast('Ошибка поиска', 'error');
    });
}

// Загрузка дорог в видимой области
function loadRoadsInView() {
    const bounds = map.getBounds();
    const bbox = [
        bounds.getSouth(),
        bounds.getWest(),
        bounds.getNorth(),
        bounds.getEast()
    ];

    // Проверяем размер области - если слишком большая, не загружаем
    const area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
    if (area > 0.01) { // Примерно 1км x 1км
        showToast('Приблизьте карту для загрузки дорог', 'warning');
        return;
    }

    showToast('Загрузка дорог...', 'info');

    fetch('/api/roads/bbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bbox: bbox })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            displayRoads(data.roads);
            showToast(`Загружено дорог: ${data.total}`, 'success');
        } else {
            showToast('Ошибка загрузки дорог: ' + (data.error || 'Неизвестная ошибка'), 'error');
        }
    })
    .catch(error => {
        console.error('Ошибка загрузки дорог:', error);
        showToast('Ошибка загрузки дорог', 'error');
    });
}

// Отображение дорог на карте
function displayRoads(roads) {
    roadsLayer.clearLayers();

    if (!roads || roads.length === 0) {
        showToast('В этой области нет дорог', 'info');
        return;
    }

    let displayedCount = 0;

    roads.forEach(road => {
        if (road.geometry && road.geometry.length >= 2) {
            const coordinates = road.geometry.map(point => [point.lat, point.lon]);
            
            // Определяем цвет линии в зависимости от типа дороги
            const highway = road.tags.highway || 'unknown';
            let color = '#3388ff'; // По умолчанию синий
            let weight = 3;
            
            switch(highway) {
                case 'motorway':
                case 'trunk':
                    color = '#e74c3c'; // Красный для автомагистралей
                    weight = 5;
                    break;
                case 'primary':
                    color = '#f39c12'; // Оранжевый для главных дорог
                    weight = 4;
                    break;
                case 'secondary':
                case 'tertiary':
                    color = '#f1c40f'; // Желтый для второстепенных дорог
                    weight = 3;
                    break;
                case 'residential':
                case 'service':
                    color = '#95a5a6'; // Серый для жилых дорог
                    weight = 2;
                    break;
                default:
                    color = '#3498db'; // Голубой для остальных
                    weight = 3;
            }
            
            const polyline = L.polyline(coordinates, {
                color: color,
                weight: weight,
                opacity: 0.8
            }).addTo(roadsLayer);

            // Добавляем обработчик клика
            polyline.on('click', function(e) {
                e.originalEvent.stopPropagation();
                openRoadEditor(road);
            });

            // Подсветка при наведении
            polyline.on('mouseover', function(e) {
                e.target.setStyle({
                    weight: weight + 2,
                    opacity: 1
                });
            });
            
            polyline.on('mouseout', function(e) {
                e.target.setStyle({
                    weight: weight,
                    opacity: 0.8
                });
            });

            // Тултип с информацией о дороге
            const roadName = road.tags.name || `${highway} (${road.id})`;
            const lanesInfo = road.tags.lanes ? ` • ${road.tags.lanes} полос` : '';
            const maxspeedInfo = road.tags.maxspeed ? ` • ${road.tags.maxspeed}` : '';
            
            polyline.bindTooltip(`${roadName}${lanesInfo}${maxspeedInfo}`, {
                permanent: false,
                direction: 'top'
            });
            
            displayedCount++;
        }
    });

    console.log(`Отображено дорог: ${displayedCount} из ${roads.length}`);
}

// Открытие редактора дороги
function openRoadEditor(road) {
    currentRoad = road;
    
    showToast('Загрузка данных дороги...', 'info');

    // Загружаем детальные данные дороги
    fetch(`/api/way/${road.id}`)
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            currentWayData = data.way;
            
            const roadName = road.tags.name || road.tags.highway || `Дорога ${road.id}`;
            document.getElementById('modalTitle').textContent = `Редактор: ${roadName}`;
            document.getElementById('wayId').textContent = road.id;

            displayRoadTags(currentWayData.tags);
            displayLanes();
            updateOSMPreview();

            document.getElementById('roadModal').style.display = 'block';
        } else {
            showToast('Ошибка загрузки данных дороги', 'error');
        }
    })
    .catch(error => {
        console.error('Ошибка загрузки дороги:', error);
        showToast('Ошибка загрузки дороги', 'error');
    });
}

// Отображение тегов дороги
function displayRoadTags(tags) {
    const container = document.getElementById('roadTags');
    container.innerHTML = '';

    const importantTags = ['name', 'highway', 'lanes', 'turn:lanes', 'maxspeed', 'surface', 'oneway'];
    
    importantTags.forEach(key => {
        if (tags[key]) {
            const tagDiv = document.createElement('div');
            tagDiv.className = 'tag-item';
            tagDiv.innerHTML = `
                <span class="tag-key">${key}:</span>
                <span class="tag-value">${tags[key]}</span>
            `;
            container.appendChild(tagDiv);
        }
    });

    // Показываем все остальные теги
    const otherTags = Object.keys(tags).filter(key => !importantTags.includes(key));
    if (otherTags.length > 0) {
        const moreDiv = document.createElement('div');
        moreDiv.className = 'tag-item';
        moreDiv.innerHTML = `
            <span class="tag-key">Другие теги:</span>
            <span class="tag-value">${otherTags.length} тегов</span>
        `;
        moreDiv.style.cursor = 'pointer';
        moreDiv.onclick = function() {
            const details = otherTags.map(key => `${key}=${tags[key]}`).join(', ');
            alert('Другие теги:\n' + details);
        };
        container.appendChild(moreDiv);
    }
}

// Отображение полос
function displayLanes() {
    const container = document.getElementById('lanesList');
    container.innerHTML = '';

    if (!currentWayData) return;

    const lanes = parseLanesFromTags(currentWayData.tags);
    
    if (lanes.length === 0) {
        container.innerHTML = '<p style="text-align: center; padding: 20px; color: #6c757d;">Добавьте полосы для редактирования</p>';
        return;
    }
    
    lanes.forEach((lane, index) => {
        const laneDiv = createLaneEditor(lane, index);
        container.appendChild(laneDiv);
    });
}

// Парсинг полос из OSM тегов
function parseLanesFromTags(tags) {
    const lanesCount = parseInt(tags.lanes || '2'); // По умолчанию 2 полосы
    const turnLanes = tags['turn:lanes'] ? tags['turn:lanes'].split('|') : [];
    
    const lanes = [];
    for (let i = 0; i < lanesCount; i++) {
        const lane = {
            index: i,
            type: 'general',
            turns: turnLanes[i] ? turnLanes[i].split(';') : ['through']
        };
        lanes.push(lane);
    }
    
    return lanes;
}

// Создание редактора полосы
function createLaneEditor(lane, index) {
    const div = document.createElement('div');
    div.className = 'lane-item';
    div.dataset.laneIndex = index;
    
    div.innerHTML = `
        <div class="lane-number">${index + 1}</div>
        
        <select class="lane-type-select" onchange="updateLaneType(${index}, this.value)">
            <option value="general" ${lane.type === 'general' ? 'selected' : ''}>Обычная</option>
            <option value="bus" ${lane.type === 'bus' ? 'selected' : ''}>Автобусная</option>
            <option value="bicycle" ${lane.type === 'bicycle' ? 'selected' : ''}>Велосипедная</option>
            <option value="taxi" ${lane.type === 'taxi' ? 'selected' : ''}>Такси</option>
        </select>
        
        <div class="turns-section">
            <div class="turns-checkboxes">
                <div class="turn-checkbox">
                    <input type="checkbox" id="left_${index}" ${lane.turns.includes('left') ? 'checked' : ''} 
                           onchange="updateOSMPreview()">
                    <label for="left_${index}">← Налево</label>
                </div>
                <div class="turn-checkbox">
                    <input type="checkbox" id="through_${index}" ${lane.turns.includes('through') ? 'checked' : ''} 
                           onchange="updateOSMPreview()">
                    <label for="through_${index}">↑ Прямо</label>
                </div>
                <div class="turn-checkbox">
                    <input type="checkbox" id="right_${index}" ${lane.turns.includes('right') ? 'checked' : ''} 
                           onchange="updateOSMPreview()">
                    <label for="right_${index}">→ Направо</label>
                </div>
                <div class="turn-checkbox">
                    <input type="checkbox" id="reverse_${index}" ${lane.turns.includes('reverse') ? 'checked' : ''} 
                           onchange="updateOSMPreview()">
                    <label for="reverse_${index}">↶ Разворот</label>
                </div>
            </div>
        </div>
    `;
    
    return div;
}

// Обновление типа полосы
function updateLaneType(index, type) {
    updateOSMPreview();
}

// Добавление полосы
function addLane() {
    if (!currentWayData) return;
    
    const currentLanes = getCurrentLanes();
    currentLanes.push({
        index: currentLanes.length,
        type: 'general',
        turns: ['through']
    });
    
    displayLanes();
    updateOSMPreview();
}

// Удаление полосы
function removeLane() {
    if (!currentWayData) return;
    
    const currentLanes = getCurrentLanes();
    if (currentLanes.length > 1) {
        displayLanes();
        updateOSMPreview();
    }
}

// Получение текущего состояния полос
function getCurrentLanes() {
    const lanes = [];
    const laneItems = document.querySelectorAll('.lane-item');
    
    laneItems.forEach((item, index) => {
        const typeSelect = item.querySelector('.lane-type-select');
        const checkboxes = item.querySelectorAll('input[type="checkbox"]:checked');
        
        const turns = Array.from(checkboxes).map(cb => {
            const parts = cb.id.split('_');
            return parts[0];
        });
        
        lanes.push({
            index,
            type: typeSelect.value,
            turns: turns.length > 0 ? turns : ['through']
        });
    });
    
    return lanes;
}

// Генерация OSM тегов из текущего состояния
function generateOSMTags() {
    if (!currentWayData) return {};
    
    const lanes = getCurrentLanes();
    const newTags = {...currentWayData.tags};
    
    // Обновляем количество полос
    newTags.lanes = lanes.length.toString();
    
    // Обновляем направления поворотов
    const turnLanes = lanes.map(lane => lane.turns.join(';'));
    newTags['turn:lanes'] = turnLanes.join('|');
    
    // Обновляем специальные типы полос
    const busLanes = lanes.map(lane => lane.type === 'bus' ? 'yes' : 'no');
    const bikeLanes = lanes.map(lane => lane.type === 'bicycle' ? 'yes' : 'no');
    
    if (busLanes.some(lane => lane === 'yes')) {
        newTags['lanes:bus'] = busLanes.join('|');
    } else {
        delete newTags['lanes:bus'];
    }
    
    if (bikeLanes.some(lane => lane === 'yes')) {
        newTags['lanes:bicycle'] = bikeLanes.join('|');
    } else {
        delete newTags['lanes:bicycle'];
    }
    
    return newTags;
}

// Обновление превью OSM тегов
function updateOSMPreview() {
    if (!currentWayData) return;
    
    const newTags = generateOSMTags();
    const container = document.getElementById('osmTags');
    
    let changesText = '';
    const oldTags = currentWayData.tags;
    
    // Показываем только изменившиеся теги
    const relevantKeys = ['lanes', 'turn:lanes', 'lanes:bus', 'lanes:bicycle'];
    
    relevantKeys.forEach(key => {
        const oldValue = oldTags[key];
        const newValue = newTags[key];
        
        if (oldValue !== newValue) {
            if (oldValue && newValue) {
                changesText += `${key}: ${oldValue} → ${newValue}\n`;
            } else if (newValue) {
                changesText += `${key}: (новый) ${newValue}\n`;
            } else if (oldValue) {
                changesText += `${key}: ${oldValue} → (удален)\n`;
            }
        }
    });
    
    if (changesText) {
        container.textContent = changesText;
    } else {
        container.textContent = 'Нет изменений';
    }
}

// Валидация изменений
function validateChanges() {
    if (!currentWayData) return;
    
    const newTags = generateOSMTags();
    
    fetch('/api/validate/lanes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: newTags })
    })
    .then(response => response.json())
    .then(data => {
        displayValidationResults(data);
    })
    .catch(error => {
        console.error('Ошибка валидации:', error);
        showToast('Ошибка валидации', 'error');
    });
}

// Отображение результатов валидации
function displayValidationResults(validation) {
    const panel = document.getElementById('validationPanel');
    const results = document.getElementById('validationResults');
    
    panel.style.display = 'block';
    results.innerHTML = '';
    
    if (validation.valid) {
        results.innerHTML = '<div class="validation-success">✓ Изменения прошли валидацию</div>';
    } else {
        if (validation.errors && validation.errors.length > 0) {
            const errorsDiv = document.createElement('div');
            errorsDiv.className = 'validation-errors';
            errorsDiv.innerHTML = '<strong>Ошибки:</strong><br>' + 
                validation.errors.map(err => `• ${err}`).join('<br>');
            results.appendChild(errorsDiv);
        }
    }
    
    if (validation.warnings && validation.warnings.length > 0) {
        const warningsDiv = document.createElement('div');
        warningsDiv.className = 'validation-warnings';
        warningsDiv.innerHTML = '<strong>Предупреждения:</strong><br>' + 
            validation.warnings.map(warn => `• ${warn}`).join('<br>');
        results.appendChild(warningsDiv);
    }
}

// Сохранение изменений в OSM
function saveChanges() {
    if (!currentWayData) return;
    
    const newTags = generateOSMTags();
    const oldTags = currentWayData.tags;
    
    // Проверяем, есть ли изменения
    const hasChanges = ['lanes', 'turn:lanes', 'lanes:bus', 'lanes:bicycle'].some(key => 
        oldTags[key] !== newTags[key]
    );
    
    if (!hasChanges) {
        showToast('Нет изменений для сохранения', 'warning');
        return;
    }
    
    const comment = prompt('Комментарий к изменению:', 'Обновление полос движения');
    if (!comment) return;
    
    showToast('Отправка изменений в OSM...', 'info');
    
    const changeData = {
        comment: comment,
        changes: [{
            way_id: currentRoad.id,
            old_tags: oldTags,
            new_tags: newTags
        }]
    };
    
    fetch('/api/changeset/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changeData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToast(`Изменения успешно отправлены! Changeset: ${data.changeset_id}`, 'success');
            closeModal();
            
            // Обновляем данные дороги
            currentWayData.tags = {...newTags};
        } else {
            showToast('Ошибка отправки изменений: ' + data.error, 'error');
        }
    })
    .catch(error => {
        console.error('Ошибка сохранения:', error);
        showToast('Ошибка отправки изменений', 'error');
    });
}

// Открытие истории изменений
function openHistoryModal() {
    fetch('/api/history')
    .then(response => response.json())
    .then(data => {
        displayHistory(data.changesets);
        document.getElementById('historyModal').style.display = 'block';
    })
    .catch(error => {
        console.error('Ошибка загрузки истории:', error);
        showToast('Ошибка загрузки истории', 'error');
    });
}

// Отображение истории
function displayHistory(changesets) {
    const container = document.getElementById('historyList');
    container.innerHTML = '';
    
    if (changesets.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #6c757d; padding: 20px;">История изменений пуста</p>';
        return;
    }
    
    changesets.forEach(changeset => {
        const div = document.createElement('div');
        div.className = 'history-item';
        
        const statusClass = changeset.status === 'sent' ? 'sent' : 'pending';
        const statusText = changeset.status === 'sent' ? 'Отправлено' : 'Ожидание';
        
        div.innerHTML = `
            <div class="history-info">
                <h4>${changeset.comment}</h4>
                <div class="history-meta">
                    ${changeset.changes_count} изменений • 
                    ${new Date(changeset.created_at).toLocaleString('ru')}
                    ${changeset.osm_changeset_id ? ` • OSM Changeset: ${changeset.osm_changeset_id}` : ''}
                </div>
            </div>
            <div class="history-status ${statusClass}">
                ${statusText}
            </div>
        `;
        
        container.appendChild(div);
    });
}

// Закрытие модальных окон
function closeModal() {
    document.getElementById('roadModal').style.display = 'none';
    document.getElementById('validationPanel').style.display = 'none';
    currentRoad = null;
    currentWayData = null;
}

function closeHistoryModal() {
    document.getElementById('historyModal').style.display = 'none';
}

// Показать toast уведомление
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const messageEl = document.getElementById('toastMessage');
    
    messageEl.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, type === 'error' ? 5000 : 3000);
}

// Обработка клавиш
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        if (document.getElementById('roadModal').style.display === 'block') {
            closeModal();
        }
        if (document.getElementById('historyModal').style.display === 'block') {
            closeHistoryModal();
        }
    }
    if (event.key === 'Enter' && event.target.id === 'searchInput') {
        searchLocation();
    }
});

// Закрытие модальных окон при клике вне них
window.onclick = function(event) {
    const roadModal = document.getElementById('roadModal');
    const historyModal = document.getElementById('historyModal');
    
    if (event.target === roadModal) {
        closeModal();
    }
    if (event.target === historyModal) {
        closeHistoryModal();
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    initMap();
    showToast('Добро пожаловать в OSM Lane Editor! Найдите место и приблизьте карту для загрузки дорог.', 'success');
});