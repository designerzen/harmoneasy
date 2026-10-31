import { ControlSurface } from "../src/index"
import "../src/style.css"
import type { ControlBinding, ControlDescriptor, ControlValue } from "../src/types"

const values:Record<string,ControlValue>={cutoff:650,density:0.55,enabled:true,wave:0,pad:[0.4,0.6],range:[0.2,0.8],trigger:0,number:123,text:"Acid engine",meter:0.75,color:"#33ffb8",display:"Ready",preset:0}
const descriptors:ControlDescriptor[]=[
	{id:"cutoff",label:"Filter cutoff",widget:"dial",min:60,max:5000,scale:"log",unit:"Hz"},
	{id:"density",label:"Drum density",widget:"slider",min:0,max:1},
	{id:"enabled",label:"Engine enabled",widget:"toggle"},
	{id:"wave",label:"Waveform",widget:"radio",choices:[{label:"Saw",value:0},{label:"Square",value:1},{label:"Triangle",value:2}]},
	{id:"pad",label:"Timbre / motion",widget:"xy",min:0,max:1},
	{id:"range",label:"Velocity range",widget:"range",min:0,max:1},
	{id:"trigger",label:"Trigger fill",widget:"button"},
	{id:"number",label:"Tempo",widget:"number",min:20,max:300,step:1},
	{id:"text",label:"Patch name",widget:"text"},
	{id:"meter",label:"Output level",widget:"meter",min:0,max:1,readOnly:true},
	{id:"color",label:"Light colour",widget:"color"},
	{id:"display",label:"Connection",widget:"display",readOnly:true},
	{id:"preset",label:"Preset",widget:"select",choices:[{label:"Acid",value:0},{label:"Cloud",value:1}]}
]
const bindings:ControlBinding[]=descriptors.map(descriptor=>({key:descriptor.id,sourceLabel:"Performance synth",descriptor,read:()=>values[descriptor.id],write:value=>{values[descriptor.id]=descriptor.widget==="button"?Number(values[descriptor.id])+1:value}}))
const surface=new ControlSurface({state:{id:"demo",name:"Live control",connections:[],widgets:bindings.map(b=>({key:b.key})),theme:"neon"},bindings,change:()=>{}})
document.body.style.cssText="margin:0;background:#080d18;display:flex;justify-content:center;padding:16px"
document.body.append(surface.element)
Object.assign(window,{surfaceSmoke:{surface,values}})
