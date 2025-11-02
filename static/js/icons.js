// Иконки для полос движения
const Icons = {
    // Создание SVG элемента с поворотом
    createSvg(content, size = 16, rotateRad = 0) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', size);
        svg.setAttribute('height', size);
        svg.setAttribute('viewBox', '-8 -8 16 16');
        svg.style.transform = `rotate(${rotateRad}rad)`;
        svg.innerHTML = content;
        return svg;
    },

    // Стрелка вверх (прямо)
    arrowUp(size, rotateRad) {
        const content = `
            <path d="M0,-6 L0,6 M0,-6 L-3,-1 M0,-6 L3,-1" 
                  stroke="white" 
                  stroke-width="1.6" 
                  fill="none" 
                  stroke-linecap="round"/>
        `;
        return this.createSvg(content, size, rotateRad);
    },

    // Стрелка влево
    arrowLeft(size, rotateRad) {
        const content = `
            <path d="M-6,0 L6,0 M-6,0 L-1,-3 M-6,0 L-1,3" 
                  stroke="white" 
                  stroke-width="1.6" 
                  fill="none" 
                  stroke-linecap="round"/>
        `;
        return this.createSvg(content, size, rotateRad);
    },

    // Стрелка вправо
    arrowRight(size, rotateRad) {
        const content = `
            <path d="M6,0 L-6,0 M6,0 L1,-3 M6,0 L1,3" 
                  stroke="white" 
                  stroke-width="1.6" 
                  fill="none" 
                  stroke-linecap="round"/>
        `;
        return this.createSvg(content, size, rotateRad);
    },

    // Стрелка вверх-вправо
    arrowUpRight(size, rotateRad) {
        const content = `
            <path d="M0,6 L0,-3 L5,-3 M5,-3 L2,-6 M5,-3 L2,0" 
                  stroke="white" 
                  stroke-width="1.6" 
                  fill="none" 
                  stroke-linecap="round"/>
        `;
        return this.createSvg(content, size, rotateRad);
    },

    // Стрелка вверх-влево
    arrowUpLeft(size, rotateRad) {
        const content = `
            <path d="M0,6 L0,-3 L-5,-3 M-5,-3 L-2,-6 M-5,-3 L-2,0" 
                  stroke="white" 
                  stroke-width="1.6" 
                  fill="none" 
                  stroke-linecap="round"/>
        `;
        return this.createSvg(content, size, rotateRad);
    },

    // Разворот
    uturn(size, rotateRad) {
        const content = `
            <path d="M2,6 L2,-2 a2,2 0 0 0 -4,0 L0,0" 
                  stroke="white" 
                  stroke-width="1.6" 
                  fill="none" 
                  stroke-linecap="round"/>
        `;
        return this.createSvg(content, size, rotateRad);
    },

    // Автобусная полоса (буква A)
    busA(size, rotateRad) {
        const content = `
            <text x="-4.5" y="3" 
                  font-size="9" 
                  fill="white" 
                  font-weight="bold">A</text>
        `;
        return this.createSvg(content, size, rotateRad);
    },

    // Велосипедная полоса
    bike(size, rotateRad) {
        const content = `
            <circle cx="-2" cy="2" r="1.8" 
                    fill="none" 
                    stroke="white" 
                    stroke-width="1.3"/>
            <circle cx="2" cy="2" r="1.8" 
                    fill="none" 
                    stroke="white" 
                    stroke-width="1.3"/>
        `;
        return this.createSvg(content, size, rotateRad);
    },

    // Парковка (буква P)
    parking(size, rotateRad) {
        const content = `
            <text x="-4" y="3" 
                  font-size="9" 
                  fill="white" 
                  font-weight="bold">P</text>
        `;
        return this.createSvg(content, size, rotateRad);
    },

    // Получить иконку для полосы
    getLaneIcon(lane, angleRad, size = 16) {
        const has = (turn) => lane.turns.includes(turn);
        
        // Сначала проверяем тип полосы
        if (lane.type === 'bus') {
            return this.busA(size, angleRad);
        }
        if (lane.type === 'bike') {
            return this.bike(size, angleRad);
        }
        if (lane.type === 'parking') {
            return this.parking(size, angleRad);
        }
        
        // Затем проверяем направления движения
        if (has('uturn')) {
            return this.uturn(size, angleRad);
        }
        if (has('through') && has('right')) {
            return this.arrowUpRight(size, angleRad);
        }
        if (has('through') && has('left')) {
            return this.arrowUpLeft(size, angleRad);
        }
        if (has('left')) {
            return this.arrowLeft(size, angleRad);
        }
        if (has('right')) {
            return this.arrowRight(size, angleRad);
        }
        
        // По умолчанию - стрелка прямо
        return this.arrowUp(size, angleRad);
    }
};