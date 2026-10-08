import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x10151b);
scene.fog=new THREE.Fog(0x10151b,22,70);
const camera=new THREE.PerspectiveCamera(70,innerWidth/innerHeight,.1,150);
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setSize(innerWidth,innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true; document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xbfd7ff,0x151515,1.5));
const sun=new THREE.DirectionalLight(0xffffff,2); sun.position.set(12,25,8); sun.castShadow=true; scene.add(sun);

const floor=new THREE.Mesh(new THREE.PlaneGeometry(90,90),new THREE.MeshStandardMaterial({color:0x242a30,roughness:.95}));
floor.rotation.x=-Math.PI/2; floor.receiveShadow=true; scene.add(floor);
const grid=new THREE.GridHelper(90,45,0x3b4249,0x252a2f); grid.position.y=.02; scene.add(grid);

function box(x,y,z,sx,sy,sz,c=0x30363c){
 const m=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),new THREE.MeshStandardMaterial({color:c,roughness:.75}));
 m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;scene.add(m);return m;
}
for(let i=0;i<18;i++){
 const a=i/18*Math.PI*2, r=15+(i%3)*3;
 box(Math.cos(a)*r,1.2,Math.sin(a)*r,2.5,2.4,2.5,i%2?0x343b42:0x3e454c);
}
box(-7,2,-7,5,4,4,0x4a3c32); box(8,1.5,-5,7,3,3,0x394047); box(4,2,8,4,4,5,0x4a3c32);

function humanoid(color=0xff7a18){
 const g=new THREE.Group();
 const mat=new THREE.MeshStandardMaterial({color,roughness:.55});
 const dark=new THREE.MeshStandardMaterial({color:0x30363d,roughness:.8});
 const body=new THREE.Mesh(new THREE.BoxGeometry(1.25,1.6,.72),mat);body.position.y=2.15;g.add(body);
 const neck=new THREE.Mesh(new THREE.CylinderGeometry(.18,.18,.25,8),dark);neck.position.y=3.08;g.add(neck);
 const head=new THREE.Mesh(new THREE.IcosahedronGeometry(.58,1),dark);head.position.y=3.65;g.add(head);
 const visor=new THREE.Mesh(new THREE.BoxGeometry(.7,.18,.12),new THREE.MeshStandardMaterial({color:0xffa45c,emissive:0x5a2000}));visor.position.set(0,3.65,-.53);g.add(visor);
 const arms=[],legs=[];
 for(const side of [-1,1]){
   const a=new THREE.Mesh(new THREE.BoxGeometry(.38,1.35,.42),dark);a.position.set(side*.9,2.18,0);g.add(a);arms.push(a);
   const l=new THREE.Mesh(new THREE.BoxGeometry(.45,1.35,.5),dark);l.position.set(side*.38,.65,0);g.add(l);legs.push(l);
   const f=new THREE.Mesh(new THREE.BoxGeometry(.52,.22,.82),dark);f.position.set(side*.38,.05,-.18);g.add(f);
 }
 const gun=new THREE.Group();const barrel=new THREE.Mesh(new THREE.BoxGeometry(.16,.16,1.35),dark);barrel.position.z=-.7;gun.add(barrel);const grip=new THREE.Mesh(new THREE.BoxGeometry(.18,.38,.2),dark);grip.position.set(0,-.22,-.25);gun.add(grip);gun.position.set(.98,2.05,-.15);gun.rotation.y=-.08;g.add(gun);
 g.userData={arms,legs,gun};return g;
}
const player=humanoid(); player.position.set(0,0,0); scene.add(player);

function enemyMesh(){
 const g=new THREE.Group(), body=new THREE.Mesh(new THREE.BoxGeometry(1.1,1.5,.7),new THREE.MeshStandardMaterial({color:0x59636c}));body.position.y=1.8;g.add(body);
 const head=new THREE.Mesh(new THREE.IcosahedronGeometry(.55,1),new THREE.MeshStandardMaterial({color:0x343a40}));head.position.y=3;g.add(head);
 const eye=new THREE.Mesh(new THREE.BoxGeometry(.7,.16,.12),new THREE.MeshStandardMaterial({color:0xff4d24,emissive:0x991900}));eye.position.set(0,3,-.52);g.add(eye);
 for(const s of [-1,1]){const a=new THREE.Mesh(new THREE.BoxGeometry(.3,1.2,.35),new THREE.MeshStandardMaterial({color:0x464e56}));a.position.set(s*.78,1.8,0);g.add(a);const l=new THREE.Mesh(new THREE.BoxGeometry(.4,1.2,.42),new THREE.MeshStandardMaterial({color:0x3e464e}));l.position.set(s*.33,.55,0);g.add(l)}
 return g;
}
const enemies=[];
for(let i=0;i<8;i++){
 const e=enemyMesh(), a=i/8*Math.PI*2,r=7+(i%3)*2;
 e.position.set(Math.cos(a)*r,0,Math.sin(a)*r);e.userData.hp=100;e.userData.alive=true;scene.add(e);enemies.push(e);
}
let kills=0,hp=100,selected=0,inventoryOpen=false,firstPerson=false,mouseDown=false;
const items=["VOP-9","BREACH","PIKE","MEDKIT"];
const inv=document.getElementById("inventory"), invItems=document.getElementById("invItems");
items.forEach((x,i)=>{const b=document.createElement("button");b.className="inv-item"+(i===0?" selected":"");b.textContent=x;b.onclick=()=>selectItem(i);invItems.appendChild(b)});
function selectItem(i){selected=i;[...invItems.children].forEach((b,n)=>b.classList.toggle("selected",n===i));}
function setInventory(v){inventoryOpen=v;inv.classList.toggle("open",v);if(v)document.exitPointerLock?.();}
document.getElementById("invClose").onclick=()=>setInventory(false);
document.getElementById("backBtn").onclick=()=>location.href="./pivop.html";
document.getElementById("clearHome").onclick=()=>location.href="./pivop.html";

const keys={}; addEventListener("keydown",e=>{
 keys[e.code]=true;
 if(e.code==="KeyX"){setInventory(!inventoryOpen);return}
 if(e.code==="KeyQ"){firstPerson=!firstPerson;return}
 if(e.code==="ArrowLeft")selectItem((selected+items.length-1)%items.length);
 if(e.code==="ArrowRight")selectItem((selected+1)%items.length);
 if(e.code==="KeyE"&&!inventoryOpen)shoot();
 if(e.code==="Space")jump();
});
addEventListener("keyup",e=>keys[e.code]=false);
renderer.domElement.addEventListener("click",()=>{if(!inventoryOpen)renderer.domElement.requestPointerLock?.()});
let yaw=0,pitch=0;
addEventListener("mousemove",e=>{
 if(document.pointerLockElement!==renderer.domElement||inventoryOpen)return;
 yaw-=e.movementX*.0025;pitch-=e.movementY*.0025;pitch=Math.max(-1.15,Math.min(1.15,pitch));
});
renderer.domElement.addEventListener("mousedown",e=>{if(e.button===0&&!inventoryOpen){melee();}});
let vy=0,onGround=true;
function jump(){if(onGround&&!inventoryOpen){vy=7;onGround=false}}
const ray=new THREE.Raycaster();
function muzzleFlash(pos){
 const s=new THREE.Mesh(new THREE.SphereGeometry(.16,8,8),new THREE.MeshBasicMaterial({color:0xffc15a}));
 s.position.copy(pos);scene.add(s);setTimeout(()=>scene.remove(s),70);
}
function shoot(){
 if(selected===2){melee();return}
 const dir=new THREE.Vector3();camera.getWorldDirection(dir);
 ray.set(camera.position,dir);
 const hits=ray.intersectObjects(enemies,true);
 if(hits.length){let o=hits[0].object;while(o.parent&&!o.userData.hp)o=o.parent;if(o.userData.hp){o.userData.hp-=50;muzzleFlash(camera.position);if(o.userData.hp<=0)kill(o)}}
}
function melee(){
 const dir=new THREE.Vector3();camera.getWorldDirection(dir);ray.set(camera.position,dir);
 const hits=ray.intersectObjects(enemies,true);
 if(hits.length&&hits[0].distance<3.3){let o=hits[0].object;while(o.parent&&!o.userData.hp)o=o.parent;if(o.userData.hp){o.userData.hp-=100;if(o.userData.hp<=0)kill(o)}}
}
function kill(e){if(!e.userData.alive)return;e.userData.alive=false;e.visible=false;kills++;document.getElementById("objective").textContent=`목표: 적 ${kills} / 8`;if(kills>=8)setTimeout(()=>document.getElementById("clearScreen").classList.add("show"),300)}

function update(dt){
 const dir=new THREE.Vector3();
 if(keys.KeyW)dir.z-=1;if(keys.KeyS)dir.z+=1;if(keys.KeyA)dir.x-=1;if(keys.KeyD)dir.x+=1;
 dir.normalize().applyAxisAngle(new THREE.Vector3(0,1,0),yaw);
 player.position.addScaledVector(dir,dt*5.5);
 player.position.x=Math.max(-18,Math.min(18,player.position.x));player.position.z=Math.max(-18,Math.min(18,player.position.z));
 vy-=18*dt;player.position.y+=vy*dt;if(player.position.y<=0){player.position.y=0;vy=0;onGround=true}
 if(dir.lengthSq()>0){player.rotation.y=Math.atan2(dir.x,dir.z);player.userData.legs[0].rotation.x=Math.sin(performance.now()*.012)*.45;player.userData.legs[1].rotation.x=-player.userData.legs[0].rotation.x}
 for(const e of enemies)if(e.userData.alive){const to=player.position.clone().sub(e.position);to.y=0;const d=to.length();if(d>1.5&&d<17){to.normalize();e.position.addScaledVector(to,dt*1.7);e.lookAt(player.position.x,e.position.y+1,player.position.z)}if(d<1.6){hp=Math.max(0,hp-dt*13);document.getElementById("hpFill").style.width=hp+"%";document.getElementById("hpText").textContent=Math.round(hp);if(hp<=0){hp=100;player.position.set(0,0,0)}}}
 const camTarget=player.position.clone().add(new THREE.Vector3(0,2.5,0));
 if(firstPerson){camera.position.copy(player.position).add(new THREE.Vector3(0,2.9,0));camera.rotation.order="YXZ";camera.rotation.y=yaw;camera.rotation.x=pitch}
 else{const off=new THREE.Vector3(0,2.7,6.5).applyAxisAngle(new THREE.Vector3(0,1,0),yaw);camera.position.copy(player.position).add(off);camera.lookAt(camTarget)}
}
let last=performance.now();function loop(t){const dt=Math.min(.033,(t-last)/1000);last=t;update(dt);renderer.render(scene,camera);requestAnimationFrame(loop)}requestAnimationFrame(loop);
addEventListener("resize",()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
