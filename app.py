from flask import Flask, render_template, request, jsonify, session, redirect, url_for, flash
import requests
import xml.etree.ElementTree as ET
from datetime import datetime
import urllib.parse
import secrets
import sqlite3
import json
import os
from functools import wraps

# Загружаем переменные окружения
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    print("⚠️  python-dotenv не установлен. Используем системные переменные окружения.")

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'dev_secret_key_CHANGE_IN_PRODUCTION')

# OSM OAuth 2.0 настройки
OSM_CLIENT_ID = os.environ.get('OSM_CLIENT_ID')
OSM_CLIENT_SECRET = os.environ.get('OSM_CLIENT_SECRET')
OSM_REDIRECT_URI = os.environ.get('OSM_REDIRECT_URI', 'http://127.0.0.1:5500/oauth/callback')

def check_oauth_config():
    """Проверка конфигурации OAuth"""
    errors = []
    
    if not OSM_CLIENT_ID:
        errors.append("OSM_CLIENT_ID не задан")
    
    if not OSM_CLIENT_SECRET:
        errors.append("OSM_CLIENT_SECRET не задан")
    
    if errors:
        print("❌ ОШИБКА КОНФИГУРАЦИИ:")
        for error in errors:
            print(f"   • {error}")
        print("\n📋 Требуется:")
        print("   1. Зарегистрировать OAuth приложение на https://www.openstreetmap.org/oauth2/applications")
        print("   2. Создать файл .env с учетными данными:")
        print("      SECRET_KEY=your_secret_key")
        print("      OSM_CLIENT_ID=your_client_id")
        print("      OSM_CLIENT_SECRET=your_client_secret")
        print("      OSM_REDIRECT_URI=http://127.0.0.1:5500/oauth/callback")
        return False
    
    return True

# OSM API URLs
OSM_API_BASE = 'https://api.openstreetmap.org'
OSM_AUTH_URL = 'https://www.openstreetmap.org/oauth2/authorize'
OSM_TOKEN_URL = 'https://www.openstreetmap.org/oauth2/token'

class DatabaseManager:
    def __init__(self):
        self.db_path = 'osm_editor.db'
        self.init_database()
    
    def init_database(self):
        """Инициализация базы данных"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                osm_id INTEGER UNIQUE,
                username TEXT,
                display_name TEXT,
                access_token TEXT,
                refresh_token TEXT,
                token_expires_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS changesets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                osm_changeset_id INTEGER,
                comment TEXT,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                sent_at TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS road_changes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                changeset_id INTEGER,
                osm_way_id INTEGER,
                old_tags TEXT,
                new_tags TEXT,
                change_type TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (changeset_id) REFERENCES changesets (id)
            )
        ''')
        
        conn.commit()
        conn.close()
    
    def get_connection(self):
        conn = sqlite3.connect(self.db_path)
        try:
            conn.row_factory = sqlite3.Row
        except:
            def dict_factory(cursor, row):
                return dict(zip([col[0] for col in cursor.description], row))
            conn.row_factory = dict_factory
        return conn
    
    def save_user(self, user_data):
        conn = self.get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT OR REPLACE INTO users 
                (osm_id, username, display_name, access_token, refresh_token, token_expires_at)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                user_data['id'],
                user_data.get('username', ''),
                user_data.get('display_name', ''),
                user_data['access_token'],
                user_data.get('refresh_token'),
                user_data.get('expires_at')
            ))
            
            cursor.execute('SELECT id FROM users WHERE osm_id = ?', (user_data['id'],))
            result = cursor.fetchone()
            
            if result:
                user_id = result['id'] if isinstance(result, dict) else result[0]
            else:
                user_id = cursor.lastrowid
                
            conn.commit()
            return user_id
            
        except Exception as e:
            print(f"Ошибка сохранения пользователя: {e}")
            return None
        finally:
            conn.close()
    
    def get_user_by_osm_id(self, osm_id):
        conn = self.get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute('SELECT * FROM users WHERE osm_id = ?', (osm_id,))
            user = cursor.fetchone()
            
            if user:
                if isinstance(user, dict):
                    return user
                else:
                    columns = [description[0] for description in cursor.description]
                    return dict(zip(columns, user))
            return None
            
        except Exception as e:
            print(f"Ошибка получения пользователя: {e}")
            return None
        finally:
            conn.close()
    
    def save_changeset(self, user_id, comment, road_changes):
        conn = self.get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO changesets (user_id, comment)
                VALUES (?, ?)
            ''', (user_id, comment))
            
            changeset_id = cursor.lastrowid
            
            for change in road_changes:
                cursor.execute('''
                    INSERT INTO road_changes 
                    (changeset_id, osm_way_id, old_tags, new_tags, change_type)
                    VALUES (?, ?, ?, ?, ?)
                ''', (
                    changeset_id,
                    change['way_id'],
                    json.dumps(change['old_tags']),
                    json.dumps(change['new_tags']),
                    change.get('change_type', 'modify')
                ))
            
            conn.commit()
            return changeset_id
            
        except Exception as e:
            print(f"Ошибка сохранения changeset: {e}")
            return None
        finally:
            conn.close()

db = DatabaseManager()

class OSMAPIClient:
    def __init__(self, access_token=None):
        self.access_token = access_token
        self.session = requests.Session()
        if access_token:
            self.session.headers.update({
                'Authorization': f'Bearer {access_token}',
                'User-Agent': 'OSM-Lane-Editor/1.0'
            })
    
    def get_user_details(self):
        try:
            response = self.session.get(f'{OSM_API_BASE}/api/0.6/user/details')
            response.raise_for_status()
            
            root = ET.fromstring(response.text)
            user_elem = root.find('user')
            
            return {
                'id': int(user_elem.get('id')),
                'username': user_elem.get('account_created'),
                'display_name': user_elem.get('display_name')
            }
        except Exception as e:
            print(f"Ошибка получения данных пользователя: {e}")
            return None
    
    def create_changeset(self, comment, bbox=None):
        changeset_xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="OSM-Lane-Editor">
  <changeset>
    <tag k="comment" v="{comment}" />
    <tag k="created_by" v="OSM Lane Editor" />
    <tag k="source" v="survey" />
  </changeset>
</osm>'''
        
        try:
            response = self.session.put(
                f'{OSM_API_BASE}/api/0.6/changeset/create',
                data=changeset_xml,
                headers={'Content-Type': 'text/xml'}
            )
            response.raise_for_status()
            return int(response.text)
        except Exception as e:
            print(f"Ошибка создания changeset: {e}")
            return None
    
    def get_way(self, way_id):
        try:
            response = self.session.get(f'{OSM_API_BASE}/api/0.6/way/{way_id}')
            response.raise_for_status()
            
            root = ET.fromstring(response.text)
            way_elem = root.find('way')
            
            way_data = {
                'id': way_elem.get('id'),
                'version': way_elem.get('version'),
                'tags': {},
                'nodes': []
            }
            
            for tag in way_elem.findall('tag'):
                way_data['tags'][tag.get('k')] = tag.get('v')
            
            for nd in way_elem.findall('nd'):
                way_data['nodes'].append(nd.get('ref'))
            
            return way_data
        except Exception as e:
            print(f"Ошибка получения дороги {way_id}: {e}")
            return None
    
    def update_way(self, changeset_id, way_data):
        way_xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="OSM-Lane-Editor">
  <way id="{way_data['id']}" version="{way_data['version']}" changeset="{changeset_id}">
'''
        
        for node_id in way_data['nodes']:
            way_xml += f'    <nd ref="{node_id}" />\n'
        
        for key, value in way_data['tags'].items():
            value_escaped = value.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
            way_xml += f'    <tag k="{key}" v="{value_escaped}" />\n'
        
        way_xml += '  </way>\n</osm>'
        
        try:
            response = self.session.put(
                f'{OSM_API_BASE}/api/0.6/way/{way_data["id"]}',
                data=way_xml,
                headers={'Content-Type': 'text/xml'}
            )
            response.raise_for_status()
            return int(response.text)
        except Exception as e:
            print(f"Ошибка обновления дороги {way_data['id']}: {e}")
            return None
    
    def close_changeset(self, changeset_id):
        try:
            response = self.session.put(f'{OSM_API_BASE}/api/0.6/changeset/{changeset_id}/close')
            response.raise_for_status()
            return True
        except Exception as e:
            print(f"Ошибка закрытия changeset {changeset_id}: {e}")
            return False

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

@app.route('/')
def index():
    if 'user' in session:
        return render_template('editor.html', user=session['user'])
    else:
        return render_template('login.html')

@app.route('/login')
def login():
    if 'user' in session:
        return redirect(url_for('index'))
    return render_template('login.html')

@app.route('/oauth/authorize')
def oauth_authorize():
    if not OSM_CLIENT_ID:
        flash('OAuth не настроен. Проверьте конфигурацию.', 'error')
        return redirect(url_for('login'))
    
    state = secrets.token_urlsafe(32)
    session['oauth_state'] = state
    
    params = {
        'client_id': OSM_CLIENT_ID,
        'redirect_uri': OSM_REDIRECT_URI,
        'response_type': 'code',
        'scope': 'read_prefs write_api',
        'state': state
    }
    
    auth_url = f"{OSM_AUTH_URL}?{urllib.parse.urlencode(params)}"
    return redirect(auth_url)

@app.route('/oauth/callback')
def oauth_callback():
    code = request.args.get('code')
    state = request.args.get('state')
    error = request.args.get('error')
    
    if error:
        flash(f'Ошибка авторизации OSM: {error}', 'error')
        return redirect(url_for('login'))
    
    if not state or state != session.get('oauth_state'):
        flash('Ошибка авторизации: неверный state', 'error')
        return redirect(url_for('login'))
    
    if not code:
        flash('Ошибка авторизации: код не получен', 'error')
        return redirect(url_for('login'))
    
    token_data = {
        'client_id': OSM_CLIENT_ID,
        'client_secret': OSM_CLIENT_SECRET,
        'code': code,
        'grant_type': 'authorization_code',
        'redirect_uri': OSM_REDIRECT_URI
    }
    
    try:
        response = requests.post(OSM_TOKEN_URL, data=token_data)
        
        if response.status_code != 200:
            print(f"❌ Ошибка получения токена: {response.text}")
            flash(f'Ошибка получения токена: {response.status_code}', 'error')
            return redirect(url_for('login'))
            
        token_response = response.json()
        
        if 'access_token' not in token_response:
            flash('Ошибка: токен не получен', 'error')
            return redirect(url_for('login'))
        
        access_token = token_response['access_token']
        
        osm_client = OSMAPIClient(access_token)
        user_info = osm_client.get_user_details()
        
        if user_info:
            user_info['access_token'] = access_token
            user_info['refresh_token'] = token_response.get('refresh_token')
            
            db.save_user(user_info)
            
            session['user'] = user_info
            session['access_token'] = access_token
            
            flash('Успешная авторизация!', 'success')
            return redirect(url_for('index'))
        else:
            flash('Ошибка получения данных пользователя', 'error')
            return redirect(url_for('login'))
            
    except Exception as e:
        print(f"❌ Ошибка OAuth: {e}")
        flash('Ошибка авторизации', 'error')
        return redirect(url_for('login'))

@app.route('/logout')
def logout():
    session.clear()
    flash('Вы вышли из системы', 'info')
    return redirect(url_for('login'))

@app.route('/api/roads/search', methods=['POST'])
@login_required
def search_roads():
    data = request.json
    query = data.get('query', '')
    
    if not query:
        return jsonify({'error': 'Пустой поисковый запрос'}), 400
    
    try:
        nominatim_url = 'https://nominatim.openstreetmap.org/search'
        headers = {'User-Agent': 'OSM-Lane-Editor/1.0'}
        params = {
            'q': query,
            'format': 'json',
            'limit': 10,
            'addressdetails': 1
        }
        
        response = requests.get(nominatim_url, params=params, headers=headers)
        response.raise_for_status()
        results = response.json()
        
        search_results = []
        for result in results:
            lat = float(result['lat'])
            lon = float(result['lon'])
            
            bbox_size = 0.005
            bbox = [lat - bbox_size, lon - bbox_size, lat + bbox_size, lon + bbox_size]
            
            search_results.append({
                'name': result['display_name'],
                'lat': lat,
                'lon': lon,
                'bbox': bbox
            })
        
        return jsonify({'success': True, 'results': search_results})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/roads/bbox', methods=['POST'])
@login_required
def load_roads_by_bbox():
    data = request.json
    bbox = data.get('bbox')
    
    if not bbox or len(bbox) != 4:
        return jsonify({'error': 'Неверный формат bbox'}), 400
    
    try:
        overpass_url = 'https://overpass-api.de/api/interpreter'
        query = f"""
        [out:json][timeout:25];
        (
          way["highway"]({bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]});
        );
        out geom;
        """
        
        headers = {'User-Agent': 'OSM-Lane-Editor/1.0'}
        
        response = requests.post(overpass_url, data=query, timeout=30, headers=headers)
        response.raise_for_status()
        overpass_data = response.json()
        
        roads = []
        
        for element in overpass_data.get('elements', []):
            if element.get('type') == 'way' and 'geometry' in element:
                geometry = element.get('geometry', [])
                if len(geometry) < 2:
                    continue
                    
                tags = element.get('tags', {})
                highway_type = tags.get('highway', '')
                
                if highway_type in ['footway', 'path', 'steps', 'cycleway']:
                    continue
                
                road = {
                    'id': element['id'],
                    'type': 'way',
                    'geometry': geometry,
                    'tags': tags
                }
                
                roads.append(road)
        
        return jsonify({
            'success': True,
            'roads': roads,
            'total': len(roads)
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/way/<int:way_id>', methods=['GET'])
@login_required
def get_way_details(way_id):
    try:
        overpass_url = 'https://overpass-api.de/api/interpreter'
        query = f"""
        [out:xml][timeout:25];
        way({way_id});
        out;
        """
        
        headers = {'User-Agent': 'OSM-Lane-Editor/1.0'}
        response = requests.post(overpass_url, data=query, timeout=30, headers=headers)
        
        if response.status_code == 200:
            root = ET.fromstring(response.text)
            way_elem = root.find('way')
            
            if way_elem is not None:
                way_data = {
                    'id': way_elem.get('id'),
                    'version': way_elem.get('version', '1'),
                    'tags': {},
                    'nodes': []
                }
                
                for tag in way_elem.findall('tag'):
                    way_data['tags'][tag.get('k')] = tag.get('v')
                
                for nd in way_elem.findall('nd'):
                    way_data['nodes'].append(nd.get('ref'))
                
                return jsonify({'success': True, 'way': way_data})
        
        access_token = session.get('access_token')
        if access_token:
            osm_client = OSMAPIClient(access_token)
            way_data = osm_client.get_way(way_id)
            if way_data:
                return jsonify({'success': True, 'way': way_data})
        
        return jsonify({'error': 'Дорога не найдена'}), 404
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/validate/lanes', methods=['POST'])
@login_required
def validate_lanes():
    try:
        data = request.json
        tags = data.get('tags', {})
        
        errors = []
        warnings = []
        
        lanes_count = tags.get('lanes')
        if lanes_count:
            try:
                lanes_int = int(lanes_count)
                if lanes_int <= 0:
                    errors.append('Количество полос должно быть положительным числом')
                elif lanes_int > 12:
                    warnings.append('Очень большое количество полос (>12)')
            except ValueError:
                errors.append('Количество полос должно быть числом')
        
        turn_lanes = tags.get('turn:lanes')
        if turn_lanes and lanes_count:
            turn_parts = turn_lanes.split('|')
            try:
                lanes_int = int(lanes_count)
                if len(turn_parts) != lanes_int:
                    errors.append('Количество элементов в turn:lanes не соответствует количеству полос')
            except ValueError:
                pass
        
        if turn_lanes:
            valid_turns = [
                'left', 'through', 'right', 'reverse', 'slight_left', 'slight_right', 
                'sharp_left', 'sharp_right', 'merge_to_left', 'merge_to_right', 'none'
            ]
            for part in turn_lanes.split('|'):
                if part:
                    for turn in part.split(';'):
                        if turn and turn not in valid_turns:
                            warnings.append(f'Неизвестное направление поворота: {turn}')
        
        return jsonify({
            'valid': len(errors) == 0,
            'errors': errors,
            'warnings': warnings
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/changeset/create', methods=['POST'])
@login_required
def create_changeset():
    try:
        data = request.json
        comment = data.get('comment', 'Обновление полос движения')
        changes = data.get('changes', [])
        
        if not changes:
            return jsonify({'error': 'Нет изменений для отправки'}), 400
        
        access_token = session.get('access_token')
        if not access_token:
            return jsonify({'error': 'Нет токена авторизации'}), 401
            
        osm_client = OSMAPIClient(access_token)
        user = session.get('user')
        
        changeset_id = osm_client.create_changeset(comment)
        if not changeset_id:
            return jsonify({'error': 'Ошибка создания changeset'}), 500
        
        updated_ways = []
        for change in changes:
            way_id = change['way_id']
            new_tags = change['new_tags']
            
            way_data = osm_client.get_way(way_id)
            if not way_data:
                continue
            
            old_tags = way_data['tags'].copy()
            way_data['tags'].update(new_tags)
            
            new_version = osm_client.update_way(changeset_id, way_data)
            if new_version:
                updated_ways.append({
                    'way_id': way_id,
                    'old_version': way_data['version'],
                    'new_version': new_version,
                    'old_tags': old_tags,
                    'new_tags': way_data['tags']
                })
        
        osm_client.close_changeset(changeset_id)
        
        user_db = db.get_user_by_osm_id(user['id'])
        if user_db:
            changeset_local_id = db.save_changeset(user_db['id'], comment, changes)
            
            conn = db.get_connection()
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE changesets 
                SET osm_changeset_id = ?, status = 'sent', sent_at = CURRENT_TIMESTAMP
                WHERE id = ?
            ''', (changeset_id, changeset_local_id))
            conn.commit()
            conn.close()
        
        return jsonify({
            'success': True,
            'changeset_id': changeset_id,
            'updated_ways': updated_ways,
            'total_updated': len(updated_ways)
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/history')
@login_required
def get_history():
    try:
        user = session.get('user')
        user_db = db.get_user_by_osm_id(user['id'])
        
        if not user_db:
            return jsonify({'changesets': []})
        
        conn = db.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT c.*, COUNT(rc.id) as changes_count
            FROM changesets c
            LEFT JOIN road_changes rc ON c.id = rc.changeset_id
            WHERE c.user_id = ?
            GROUP BY c.id
            ORDER BY c.created_at DESC
            LIMIT 50
        ''', (user_db['id'],))
        
        changesets = []
        for row in cursor.fetchall():
            if isinstance(row, dict):
                changeset_data = row
            else:
                columns = [description[0] for description in cursor.description]
                changeset_data = dict(zip(columns, row))
                
            changesets.append({
                'id': changeset_data['id'],
                'osm_changeset_id': changeset_data['osm_changeset_id'],
                'comment': changeset_data['comment'],
                'status': changeset_data['status'],
                'changes_count': changeset_data['changes_count'],
                'created_at': changeset_data['created_at'],
                'sent_at': changeset_data['sent_at']
            })
        
        conn.close()
        
        return jsonify({'changesets': changesets})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("🚀 Запуск OSM Lane Editor...")
    
    if not check_oauth_config():
        exit(1)
    
    print("✅ OAuth конфигурация проверена")
    print(f"📱 Client ID: {OSM_CLIENT_ID[:10]}...")
    print(f"🔐 Client Secret: {'✅ Задан' if OSM_CLIENT_SECRET else '❌ Не задан'}")
    print(f"🔗 Redirect URI: {OSM_REDIRECT_URI}")
    print("🌐 Приложение будет доступно по адресу: http://127.0.0.1:5500")
    print("🛑 Для остановки нажмите Ctrl+C")
    
    app.run(debug=True, host='0.0.0.0', port=5600)