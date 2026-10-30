// OP.GG emits compact data constructors, not executable JavaScript/Python.
// Interpret the declared field map and a deliberately small literal grammar; never eval provider text.
export function parseOpggText(text:string):any{
  if(text.length>4_000_000)throw new Error('OPGG_PAYLOAD_TOO_LARGE');
  try{return JSON.parse(text);}catch{}
  const classes=new Map<string,string[]>();
  const source=text.replace(/^class ([A-Za-z][A-Za-z0-9_]*):\s*([^\n]*)\r?$/gm,(_line,name,fields)=>{
    const keys=String(fields).split(',').map(s=>s.trim()).filter(Boolean);
    if(keys.some(k=>!/^\w+$/.test(k)||['__proto__','prototype','constructor'].includes(k)))throw new Error('OPGG_INVALID_FIELDS');
    classes.set(name,keys);return '';
  }).trim();
  let index=0,nodes=0;
  const skip=()=>{while(/\s/.test(source[index]||'')&&index<source.length)index++;};
  const take=(c:string)=>{skip();if(source[index++]!==c)throw new Error('OPGG_INVALID_FORMAT');};
  function string(){
    const quote=source[index++];let value='';
    while(index<source.length){const c=source[index++];if(c===quote)return value;if(c!=='\\'){value+=c;continue;}
      const e=source[index++],escapes:Record<string,string>={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','\\':'\\',"'":"'",'"':'"','/':'/'};
      if(e in escapes){value+=escapes[e];continue;}
      const length=e==='u'?4:e==='x'?2:e==='U'?8:0;if(!length)throw new Error('OPGG_INVALID_ESCAPE');
      const hex=source.slice(index,index+length);if(!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(hex))throw new Error('OPGG_INVALID_ESCAPE');
      value+=String.fromCodePoint(parseInt(hex,16));index+=length;
    }throw new Error('OPGG_UNCLOSED_STRING');
  }
  function list(end:string,depth:number){const items:any[]=[];skip();if(source[index]===end){index++;return items;}while(index<source.length){items.push(value(depth+1));skip();if(source[index]===end){index++;return items;}take(',');skip();if(source[index]===end){index++;return items;}}throw new Error('OPGG_UNCLOSED_LIST');}
  function value(depth:number):any{
    if(depth>64||++nodes>150000)throw new Error('OPGG_FORMAT_LIMIT');skip();const c=source[index];
    if(c==='"'||c==="'")return string();
    if(c==='['){index++;return list(']',depth);}
    if(c==='{'){index++;const object:Record<string,unknown>={};skip();if(source[index]==='}'){index++;return object;}while(index<source.length){skip();const key=string();if(['__proto__','prototype','constructor'].includes(key))throw new Error('OPGG_INVALID_KEY');take(':');object[key]=value(depth+1);skip();if(source[index]==='}'){index++;return object;}take(',');}throw new Error('OPGG_UNCLOSED_OBJECT');}
    const number=source.slice(index).match(/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);if(number){index+=number[0].length;return Number(number[0]);}
    const word=source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];if(!word)throw new Error('OPGG_INVALID_VALUE');index+=word.length;
    if(['None','null'].includes(word))return null;if(['True','true'].includes(word))return true;if(['False','false'].includes(word))return false;
    const fields=classes.get(word);if(!fields)throw new Error('OPGG_UNKNOWN_CONSTRUCTOR');take('(');const args=list(')',depth);
    if(args.length!==fields.length)throw new Error('OPGG_INVALID_ARITY');return Object.fromEntries(fields.map((k,i)=>[k,args[i]]));
  }
  const result=value(0);skip();if(index!==source.length)throw new Error('OPGG_TRAILING_DATA');return result;
}
export function parseOpggResult(result:any){
  if(result.isError)throw new Error('OPGG_TOOL_ERROR');
  if(result.structuredContent)return result.structuredContent;
  const text=(result.content||[]).filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n');
  return parseOpggText(text);
}
