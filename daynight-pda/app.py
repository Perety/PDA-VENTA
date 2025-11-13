# app.py
import os
from flask import Flask, render_template, request, jsonify, session, send_from_directory
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime
import uuid

# ========== CONFIG ==========
# RUTA AL SERVICE ACCOUNT JSON (generado en Firebase Console)
SERVICE_ACCOUNT_PATH = os.path.join(os.path.dirname(__file__), 'serviceAccount.json')
if not os.path.exists(SERVICE_ACCOUNT_PATH):
    raise RuntimeError("serviceAccount.json no encontrado. Genera la clave en Firebase y colócala aquí.")

cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
firebase_admin.initialize_app(cred)
db = firestore.client()

# Flask app
app = Flask(__name__, static_folder='static', template_folder='templates')
CORS(app)
app.secret_key = os.environ.get('FLASK_SECRET', 'cambia_esta_clave_localmente_123')  # cámbiala en prod

# Utility
def uid(prefix='id'):
    return f"{prefix}_{uuid.uuid4().hex[:8]}"

def now_ts():
    return datetime.utcnow()

def push_log(msg):
    db.collection('logs').add({
        'msg': msg,
        't': firestore.SERVER_TIMESTAMP
    })

def get_roles_map():
    docs = db.collection('roles').stream()
    out = {}
    for d in docs:
        out[d.id] = d.to_dict()
    return out

# ---------- Auth helpers ----------
def current_user():
    uid = session.get('user_id')
    if not uid:
        return None
    doc = db.collection('users').document(uid).get()
    if not doc.exists:
        return None
    u = doc.to_dict()
    u['id'] = doc.id
    return u

def require_login_json():
    u = current_user()
    if not u:
        return jsonify({'ok': False, 'error': 'auth_required'}), 401
    return u

def has_perm(user, perm):
    if not user:
        return perm == 'create_call'  # invitados pueden crear llamada
    roles = get_roles_map()
    r = roles.get(user.get('role'))
    if not r:
        return False
    perms = r.get('permissions', [])
    return 'all' in perms or perm in perms

# ========== API endpoints ==========

@app.route('/')
def index():
    return render_template('index.html')

# --- Auth ---
@app.route('/api/login', methods=['POST'])
def api_login():
    data = request.json or {}
    username = data.get('username','').strip()
    password = data.get('password','')
    if not username or not password:
        return jsonify({'ok': False, 'error': 'missing'}), 400
    users_q = db.collection('users').where('username', '==', username).limit(1).stream()
    user_doc = None
    for d in users_q:
        user_doc = d
        break
    if not user_doc:
        return jsonify({'ok': False, 'error': 'invalid'}), 401
    user = user_doc.to_dict()
    if user.get('password') != password:
        return jsonify({'ok': False, 'error': 'invalid'}), 401
    # set session
    session['user_id'] = user_doc.id
    push_log(f"Sesión iniciada: {username}")
    return jsonify({'ok': True, 'user': {**user, 'id': user_doc.id}})

@app.route('/api/logout', methods=['POST'])
def api_logout():
    session.pop('user_id', None)
    return jsonify({'ok': True})

# --- Seed endpoint (solo si no hay usuarios) ---
@app.route('/api/seed', methods=['POST'])
def api_seed():
    # Solo permite seed si no hay usuarios en la colección
    docs = list(db.collection('users').limit(1).stream())
    if len(docs) > 0:
        return jsonify({'ok': False, 'error': 'already_seeded'}), 400
    # crea roles por defecto
    roles = {
        'officer': {'name': 'Officer', 'permissions': ['create_reports','create_pda','create_call']},
        'sergeant': {'name': 'Sergeant', 'permissions': ['create_reports','create_pda','create_call','delete_reports']},
        'dispatcher': {'name': 'Dispatcher', 'permissions': ['create_call','assign_call']},
        'admin': {'name': 'Admin', 'permissions': ['all']}
    }
    for k,v in roles.items():
        db.collection('roles').document(k).set(v)
    # crea admin inicial con password que cambies luego
    admin = {'username':'perety', 'display':'Perety', 'password':'Rodriguez2009_', 'role':'admin', 'badge':'ADM-001', 'onDuty': False}
    db.collection('users').add(admin)
    push_log('Seed inicial creada via API')
    return jsonify({'ok': True})

# --- Users (admin only for create/delete) ---
@app.route('/api/users', methods=['GET'])
def api_users_list():
    docs = db.collection('users').stream()
    users = []
    for d in docs:
        u = d.to_dict(); u['id'] = d.id; users.append(u)
    return jsonify({'ok': True, 'users': users})

@app.route('/api/users/create', methods=['POST'])
def api_users_create():
    u = require_login_json()
    if isinstance(u, tuple): return u  # error
    if not has_perm(u, 'manage_users'):
        return jsonify({'ok': False, 'error':'unauthorized'}), 403
    data = request.json or {}
    # forced: admin creates accounts
    new = {
        'username': data.get('username'),
        'display': data.get('display') or data.get('username'),
        'password': data.get('password') or '1234',
        'role': data.get('role') or '',
        'badge': data.get('badge',''),
        'onDuty': False
    }
    if not new['username']:
        return jsonify({'ok': False,'error':'missing username'}), 400
    # ensure unique
    q = db.collection('users').where('username','==',new['username']).get()
    if len(q) > 0:
        return jsonify({'ok': False,'error':'exists'}), 400
    db.collection('users').add(new)
    push_log(f"Usuario creado: {new['username']} por {u['username']}")
    return jsonify({'ok': True})

@app.route('/api/users/<uid>/role', methods=['POST'])
def api_change_role(uid):
    u = require_login_json()
    if isinstance(u, tuple): return u
    if not has_perm(u, 'manage_users'):
        return jsonify({'ok': False, 'error':'unauthorized'}), 403
    data = request.json or {}
    new_role = data.get('role','')
    doc = db.collection('users').document(uid)
    if not doc.get().exists:
        return jsonify({'ok': False,'error':'notfound'}), 404
    doc.update({'role': new_role})
    push_log(f"Rol cambiado: {uid} -> {new_role} por {u['username']}")
    return jsonify({'ok': True})

@app.route('/api/users/<uid>/delete', methods=['POST'])
def api_delete_user(uid):
    u = require_login_json()
    if isinstance(u, tuple): return u
    if not has_perm(u, 'manage_users'):
        return jsonify({'ok': False, 'error':'unauthorized'}), 403
    target = db.collection('users').document(uid).get()
    if not target.exists:
        return jsonify({'ok': False,'error':'notfound'}), 404
    tdata = target.to_dict()
    if tdata.get('username') == 'admin':
        return jsonify({'ok':False,'error':'cannot_delete_seed_admin'}), 400
    # set off duty if present
    db.collection('onDuty').document(uid).delete()
    db.collection('users').document(uid).delete()
    push_log(f"Usuario borrado: {uid} por {u['username']}")
    return jsonify({'ok': True})

# --- On duty toggle ---
@app.route('/api/toggle_duty', methods=['POST'])
def api_toggle_duty():
    u = require_login_json()
    if isinstance(u, tuple): return u
    uid = session.get('user_id')
    if not uid:
        return jsonify({'ok': False}), 401
    onDutyRef = db.collection('onDuty').document(uid)
    cur = onDutyRef.get()
    if cur.exists:
        # toggle off
        onDutyRef.delete()
        push_log(f"{u['display']} salió de servicio")
        return jsonify({'ok': True, 'status': 'off'})
    else:
        onDutyRef.set({'since': firestore.SERVER_TIMESTAMP, 'display': u['display']})
        push_log(f"{u['display']} entró en servicio")
        return jsonify({'ok': True, 'status': 'on'})

@app.route('/api/onDutyList', methods=['GET'])
def api_onDutyList():
    docs = db.collection('onDuty').stream()
    out = []
    for d in docs:
        info = d.to_dict(); info['id'] = d.id; out.append(info)
    return jsonify({'ok': True, 'onDuty': out})

# --- Calls (dispatch) ---
@app.route('/api/calls', methods=['GET'])
def api_calls_list():
    docs = db.collection('calls').order_by('created_at', direction=firestore.Query.DESCENDING).stream()
    out = []
    for d in docs:
        item = d.to_dict(); item['id'] = d.id; out.append(item)
    return jsonify({'ok': True, 'calls': out})

@app.route('/api/calls/create', methods=['POST'])
def api_calls_create():
    data = request.json or {}
    caller = data.get('caller') or 'Anonimo'
    message = data.get('message') or ''
    if not message:
        return jsonify({'ok': False, 'error':'missing_message'}), 400
    doc = {
        'caller': caller,
        'message': message,
        'status': 'pending',
        'assigned_to': None,
        'created_at': firestore.SERVER_TIMESTAMP
    }
    new_ref = db.collection('calls').add(doc)
    push_log(f"Llamada creada por {caller}")
    # create an alert (for notifications)
    db.collection('alerts').add({'type':'call','call_id': new_ref[1].id, 'level':'info', 'created_at': firestore.SERVER_TIMESTAMP})
    return jsonify({'ok': True})

@app.route('/api/calls/<callid>/assign', methods=['POST'])
def api_calls_assign(callid):
    u = require_login_json()
    if isinstance(u, tuple): return u
    if not has_perm(u, 'assign_call'):
        return jsonify({'ok': False,'error':'unauthorized'}), 403
    call_ref = db.collection('calls').document(callid)
    doc = call_ref.get()
    if not doc.exists:
        return jsonify({'ok': False,'error':'notfound'}), 404
    call_ref.update({'status':'assigned','assigned_to': session.get('user_id')})
    push_log(f"Llamada {callid} asignada a {u['username']}")
    db.collection('alerts').add({'type':'assign','call_id':callid,'user':u['username'],'level':'info','created_at': firestore.SERVER_TIMESTAMP})
    return jsonify({'ok': True})

@app.route('/api/calls/<callid>/delete', methods=['POST'])
def api_calls_delete(callid):
    u = require_login_json()
    if isinstance(u, tuple): return u
    call_ref = db.collection('calls').document(callid)
    if not call_ref.get().exists:
        return jsonify({'ok': False,'error':'notfound'}), 404
    # only admin or assigned user may delete
    c = call_ref.get().to_dict()
    if (u['role'] != 'admin') and (c.get('assigned_to') != session.get('user_id')):
        return jsonify({'ok': False, 'error':'unauthorized'}), 403
    call_ref.delete()
    push_log(f"Llamada {callid} borrada por {u['username']}")
    return jsonify({'ok': True})

# --- Reports (informes) ---
@app.route('/api/reports', methods=['GET'])
def api_reports_list():
    docs = db.collection('reports').order_by('created_at', direction=firestore.Query.DESCENDING).stream()
    out = []
    for d in docs:
        i = d.to_dict(); i['id'] = d.id; out.append(i)
    return jsonify({'ok': True, 'reports': out})

@app.route('/api/reports/create', methods=['POST'])
def api_reports_create():
    u = require_login_json()
    if isinstance(u, tuple): return u
    if not has_perm(u, 'create_reports'):
        return jsonify({'ok': False,'error':'unauthorized'}), 403
    data = request.json or {}
    title = data.get('title','').strip()
    description = data.get('description','').strip()
    if not title or not description:
        return jsonify({'ok': False,'error':'missing'}), 400
    db.collection('reports').add({
        'title': title, 'description': description, 'author': u['display'], 'created_at': firestore.SERVER_TIMESTAMP
    })
    push_log(f"Informe creado: {title} por {u['username']}")
    return jsonify({'ok': True})

@app.route('/api/reports/<rid>/delete', methods=['POST'])
def api_reports_delete(rid):
    u = require_login_json()
    if isinstance(u, tuple): return u
    # admin or same author or sergeant
    rep = db.collection('reports').document(rid).get()
    if not rep.exists:
        return jsonify({'ok': False,'error':'notfound'}), 404
    rdata = rep.to_dict()
    if u['role'] != 'admin' and rdata.get('author') != u['display'] and u['role'] != 'sergeant':
        return jsonify({'ok': False,'error':'unauthorized'}), 403
    db.collection('reports').document(rid).delete()
    push_log(f"Informe {rid} borrado por {u['username']}")
    return jsonify({'ok': True})

# --- Wanted / BOLO ---
@app.route('/api/wanted', methods=['GET'])
def api_wanted_list():
    docs = db.collection('wanted').order_by('created_at', direction=firestore.Query.DESCENDING).stream()
    out=[]
    for d in docs:
        item = d.to_dict(); item['id']=d.id; out.append(item)
    return jsonify({'ok': True, 'wanted': out})

@app.route('/api/wanted/create', methods=['POST'])
def api_wanted_create():
    u = require_login_json()
    if isinstance(u, tuple): return u
    if not has_perm(u, 'create_bolo'):
        return jsonify({'ok': False,'error':'unauthorized'}), 403
    data = request.json or {}
    name = data.get('name','').strip()
    description = data.get('description','').strip()
    bounty = int(data.get('bounty') or 0)
    if not name:
        return jsonify({'ok': False,'error':'missing'}), 400
    db.collection('wanted').add({'name':name,'description':description,'bounty':bounty,'created_at':firestore.SERVER_TIMESTAMP})
    push_log(f"Wanted creado: {name} por {u['username']}")
    return jsonify({'ok': True})

@app.route('/api/wanted/<wid>/delete', methods=['POST'])
def api_wanted_delete(wid):
    u = require_login_json()
    if isinstance(u, tuple): return u
    if not has_perm(u, 'manage_wanted'):
        return jsonify({'ok': False,'error':'unauthorized'}), 403
    db.collection('wanted').document(wid).delete()
    push_log(f"Wanted {wid} borrado por {u['username']}")
    return jsonify({'ok': True})

# --- Fines (multas) ---
@app.route('/api/fines', methods=['GET'])
def api_fines_list():
    docs = db.collection('fines').order_by('created_at', direction=firestore.Query.DESCENDING).stream()
    out=[]
    for d in docs:
        it = d.to_dict(); it['id']=d.id; out.append(it)
    return jsonify({'ok': True, 'fines': out})

@app.route('/api/fines/create', methods=['POST'])
def api_fines_create():
    u = require_login_json()
    if isinstance(u, tuple): return u
    if not has_perm(u, 'create_fine'):
        return jsonify({'ok': False,'error':'unauthorized'}), 403
    data = request.json or {}
    offender = data.get('offender','').strip()
    amount = int(data.get('amount') or 0)
    reason = data.get('reason','').strip()
    if not offender or not amount:
        return jsonify({'ok': False,'error':'missing'}), 400
    db.collection('fines').add({'offender':offender,'amount':amount,'reason':reason,'author':u['display'],'created_at':firestore.SERVER_TIMESTAMP})
    push_log(f"Multa creada: {offender} {amount}€ por {u['username']}")
    return jsonify({'ok': True})

# --- Alerts (verde / amarilla / roja) + delete alerts ---
@app.route('/api/alerts', methods=['GET'])
def api_alerts_list():
    docs = db.collection('alerts').order_by('created_at', direction=firestore.Query.DESCENDING).stream()
    out=[]
    for d in docs:
        it = d.to_dict(); it['id'] = d.id; out.append(it)
    return jsonify({'ok': True, 'alerts': out})

@app.route('/api/alerts/create', methods=['POST'])
def api_alerts_create():
    u = current_user()  # alerts can be created by logged users (or we can allow guests)
    data = request.json or {}
    level = data.get('level','green')  # green/yellow/red
    text = data.get('text','').strip()
    db.collection('alerts').add({'level':level,'text':text,'created_by': u['username'] if u else 'guest','created_at':firestore.SERVER_TIMESTAMP})
    push_log(f"Alerta creada: {level} - {text}")
    return jsonify({'ok': True})

@app.route('/api/alerts/<aid>/delete', methods=['POST'])
def api_alerts_delete(aid):
    u = require_login_json()
    if isinstance(u, tuple): return u
    if not has_perm(u, 'manage_alerts'):
        return jsonify({'ok': False,'error':'unauthorized'}), 403
    db.collection('alerts').document(aid).delete()
    push_log(f"Alerta {aid} borrada por {u['username']}")
    return jsonify({'ok': True})

# --- Export / Import (admin) ---
@app.route('/api/export', methods=['GET'])
def api_export():
    u = require_login_json()
    if isinstance(u, tuple): return u
    if not has_perm(u, 'export'):
        return jsonify({'ok': False,'error':'unauthorized'}), 403
    coll_names = ['users','roles','reports','calls','wanted','fines','alerts','logs','onDuty','meta']
    out = {}
    for name in coll_names:
        docs = db.collection(name).stream()
        out[name] = []
        for d in docs:
            obj = d.to_dict(); obj['id'] = d.id; out[name].append(obj)
    return jsonify({'ok': True, 'data': out})

@app.route('/api/import', methods=['POST'])
def api_import():
    u = require_login_json()
    if isinstance(u, tuple): return u
    if not has_perm(u, 'export'):
        return jsonify({'ok': False,'error':'unauthorized'}), 403
    data = request.json or {}
    # naive replace for provided collections
    for k,v in data.items():
        if not isinstance(v, list): continue
        # delete existing docs in collection
        col = db.collection(k)
        for doc in col.stream():
            col.document(doc.id).delete()
        # add new ones (remove id to let firestore create new ids OR keep id)
        for item in v:
            item_copy = dict(item)
            item_copy.pop('id', None)
            col.add(item_copy)
    push_log(f"Datos importados por {u['username']}")
    return jsonify({'ok': True})

# ========== Static serving (for local dev) ==========
@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory('static', filename)

# ========== Run ==========
if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
