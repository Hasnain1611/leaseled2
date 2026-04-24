import React, { useState, useRef, useMemo, useCallback, useEffect } from "react";
import Auth from "./Auth";
import { supabase } from "./supabase";

// ── formatting ─────────────────────────────────────────────────────────────
const fmt = {
  currency: (n, ccy="£") => n != null && n !== "" ? ccy + Number(n).toLocaleString("en-GB", {minimumFractionDigits:0,maximumFractionDigits:0}) : "—",
  date: d => { if (!d) return "—"; try { return new Date(d).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}); } catch { return d; } },
  num:  n => n != null && n !== "" ? Number(n).toLocaleString("en-GB",{maximumFractionDigits:1}) : "—",
  pct:  n => n != null && n !== "" ? Number(n).toFixed(1)+"%" : "—",
  bool: n => n === 1 || n === true ? "Yes" : n === 0 || n === false ? "No" : "—",
  days: d => { if (!d) return null; const du = Math.round((new Date(d)-new Date())/86400000); return du; },
};

// ── team / approvers ───────────────────────────────────────────────────────
const TEAM = [
  { id:"sa", name:"S. Ahmed",    role:"Asset Manager",      initials:"SA" },
  { id:"jp", name:"J. Patel",    role:"Portfolio Manager",  initials:"JP" },
  { id:"lr", name:"L. Rossi",    role:"Senior AM",          initials:"LR" },
  { id:"mk", name:"M. Klein",    role:"Head of Asset Mgmt", initials:"MK" },
];

// which action types require a supporting document upload
const REQUIRES_DOC = { break_served: true, review: true, indexation: true };

// ── column definitions grouped to match BX template ────────────────────────
const COLUMN_GROUPS = [
  {
    id:"portfolio", label:"Portfolio / Asset", color:"#E8F4FD",
    cols:[
      { id:"assetId",      label:"Asset ID",          w:100, render:r=>r.assetId },
      { id:"assetName",    label:"Asset Name",         w:180, render:r=>r.assetName },
      { id:"country",      label:"Country",            w:90,  render:r=>r.country },
      { id:"city",         label:"City",               w:110, render:r=>r.city },
      { id:"portfolio",    label:"Portfolio",          w:130, render:r=>r.portfolio },
      { id:"fund",         label:"Fund",               w:100, render:r=>r.fund },
      { id:"subMarket",    label:"Sub-Market",         w:130, render:r=>r.subMarket },
      { id:"address",      label:"Full Address",       w:220, render:r=>r.address },
    ]
  },
  {
    id:"unit", label:"Unit Details", color:"#EDF7ED",
    cols:[
      { id:"unitId",       label:"Unit ID",            w:100, render:r=>r.unitId },
      { id:"demiseId",     label:"Demise ID",          w:100, render:r=>r.demiseId },
      { id:"useType",      label:"Use Type",           w:110, render:r=>r.useType },
      { id:"areaSqm",      label:"Lettable (SQM)",     w:110, render:r=>fmt.num(r.areaSqm), align:"right" },
      { id:"warehouseSqm", label:"Warehouse (SQM)",    w:120, render:r=>fmt.num(r.warehouseSqm), align:"right" },
      { id:"officeSqm",    label:"Office (SQM)",       w:110, render:r=>fmt.num(r.officeSqm), align:"right" },
      { id:"mezzanineSqm", label:"Mezzanine (SQM)",    w:120, render:r=>fmt.num(r.mezzanineSqm), align:"right" },
      { id:"occupancy",    label:"Occupied?",          w:90,  render:r=>r.occupancy===1?<Pill c="green">Occ.</Pill>:<Pill c="red">Vacant</Pill> },
      { id:"vacantSince",  label:"Vacant Since",       w:110, render:r=>fmt.date(r.vacantSince) },
    ]
  },
  {
    id:"tenant", label:"Tenant Details", color:"#FEF9EC",
    cols:[
      { id:"tenantId",     label:"Tenant ID",          w:100, render:r=>r.tenantId },
      { id:"leaseId",      label:"Lease ID",           w:100, render:r=>r.leaseId },
      { id:"tenantName",   label:"Tenant Legal Name",  w:200, render:r=><b style={{fontWeight:500}}>{r.tenantName}</b> },
      { id:"tenantTrade",  label:"Trade Name",         w:160, render:r=>r.tenantTrade },
      { id:"tenantIndustry",label:"Industry",          w:140, render:r=>r.tenantIndustry },
      { id:"tenantParent", label:"Parent",             w:160, render:r=>r.tenantParent },
      { id:"companyNum",   label:"Company #",          w:110, render:r=>r.companyNum },
    ]
  },
  {
    id:"rent", label:"Rent Details", color:"#F0F4FF",
    cols:[
      { id:"currency",     label:"Currency",           w:80,  render:r=>r.currency },
      { id:"contractedPA", label:"Contracted PA (LCY)",w:150, render:r=><span style={{fontFamily:"monospace"}}>{fmt.currency(r.contractedPA,"")}</span>, align:"right" },
      { id:"passingPA",    label:"Passing PA (LCY)",   w:140, render:r=><span style={{fontFamily:"monospace"}}>{fmt.currency(r.passingPA,"")}</span>, align:"right" },
      { id:"ervPA",        label:"ERV PA (LCY)",       w:130, render:r=><span style={{fontFamily:"monospace"}}>{fmt.currency(r.ervPA,"")}</span>, align:"right" },
      { id:"rentPsm",      label:"Rent PSM",           w:100, render:r=>r.areaSqm&&r.passingPA ? fmt.currency(r.passingPA/r.areaSqm,"")+" psm" : "—", align:"right" },
      { id:"reversionary", label:"Reversion.",         w:100, render:r=>{ if(!r.passingPA||!r.ervPA) return "—"; const v=((r.ervPA-r.passingPA)/r.passingPA*100); return <span style={{color:v>0?"#166534":v<0?"#991B1B":"#444"}}>{v>0?"+":""}{v.toFixed(1)}%</span>; }, align:"right" },
    ]
  },
  {
    id:"lease", label:"Lease Term", color:"#FFF4F0",
    cols:[
      { id:"leaseStart",   label:"Lease Start",        w:110, render:r=>fmt.date(r.leaseStart) },
      { id:"leaseExpiry",  label:"Lease Expiry",       w:110, render:r=>{ const d=r.leaseExpiry; if(!d) return <Pill c="amber">Open-ended</Pill>; const du=fmt.days(d); return <span style={{color:du<0?"#991B1B":du<365?"#92400E":"inherit"}}>{fmt.date(d)}</span>; } },
      { id:"wale",         label:"WALE (yrs)",         w:90,  render:r=>fmt.num(r.wale), align:"right" },
      { id:"walb",         label:"WALB (yrs)",         w:90,  render:r=>fmt.num(r.walb), align:"right" },
      { id:"openEnded",    label:"Open-Ended",         w:90,  render:r=>fmt.bool(r.openEnded) },
      { id:"negotiation",  label:"In Negotiation",     w:110, render:r=>r.negotiation===1?<Pill c="amber">Yes</Pill>:"—" },
      { id:"leaseStatus",  label:"Lease Status",       w:110, render:r=>r.leaseStatus },
    ]
  },
  {
    id:"breaks", label:"Break Options", color:"#FEF2F2",
    cols:[
      { id:"break1Date",   label:"Break 1 Date",       w:110, render:r=>{ const d=r.break1Date; if(!d) return "—"; const du=fmt.days(d); return <span style={{color:du<0?"#991B1B":du<180?"#92400E":"#166534",fontWeight:500}}>{fmt.date(d)}</span>; } },
      { id:"break1Notice", label:"Notice (Months)",    w:110, render:r=>r.break1Notice ? r.break1Notice+"m" : "—" },
      { id:"break1Holder", label:"Holder",             w:90,  render:r=>r.break1Holder },
      { id:"nearestNotice",label:"Nearest Notice Date",w:140, render:r=>fmt.date(r.nearestNotice) },
      { id:"break2Date",   label:"Break 2 Date",       w:110, render:r=>fmt.date(r.break2Date) },
      { id:"break2Notice", label:"Notice (Months)",    w:110, render:r=>r.break2Notice ? r.break2Notice+"m" : "—" },
      { id:"breakInfo",    label:"Break Notes",        w:200, render:r=>r.breakInfo },
    ]
  },
  {
    id:"review", label:"Rent Reviews", color:"#FDF4FF",
    cols:[
      { id:"reviewType",   label:"Review Type",        w:120, render:r=>r.reviewType?<Pill c="purple">{r.reviewType}</Pill>:"—" },
      { id:"reviewFreq",   label:"Frequency (Months)", w:140, render:r=>r.reviewFreq?r.reviewFreq+"m":"—" },
      { id:"lastReview",   label:"Last Review",        w:110, render:r=>fmt.date(r.lastReview) },
      { id:"nextReview",   label:"Next Review",        w:110, render:r=>{ const d=r.nextReview; if(!d) return "—"; const du=fmt.days(d); return <span style={{color:du<0?"#991B1B":du<90?"#92400E":"#166534",fontWeight:500}}>{fmt.date(d)}</span>; } },
      { id:"upwardsOnly",  label:"Upwards Only",       w:110, render:r=>fmt.bool(r.upwardsOnly) },
      { id:"reviewInfo",   label:"Review Notes",       w:200, render:r=>r.reviewInfo },
    ]
  },
  {
    id:"indexation", label:"Indexation", color:"#F0FDF9",
    cols:[
      { id:"hasIndex",     label:"Has Indexation",     w:110, render:r=>r.hasIndex===1?<Pill c="teal">Yes</Pill>:"—" },
      { id:"indexName",    label:"Index",              w:100, render:r=>r.indexName },
      { id:"lastIndexDate",label:"Last Index Date",    w:130, render:r=>fmt.date(r.lastIndexDate) },
      { id:"lastIndexRate",label:"Last Rate %",        w:110, render:r=>fmt.pct(r.lastIndexRate) },
      { id:"nextIndexDate",label:"Next Index Date",    w:130, render:r=>{ const d=r.nextIndexDate; if(!d) return "—"; const du=fmt.days(d); return <span style={{color:du<0?"#991B1B":du<90?"#92400E":"#166534",fontWeight:500}}>{fmt.date(d)}</span>; } },
      { id:"indexFloor",   label:"Floor %",            w:90,  render:r=>fmt.pct(r.indexFloor) },
      { id:"indexCap",     label:"Cap %",              w:90,  render:r=>fmt.pct(r.indexCap) },
    ]
  },
  {
    id:"rentfree", label:"Rent Free", color:"#FFFBEB",
    cols:[
      { id:"rfMonths",     label:"RF Period (Months)", w:140, render:r=>r.rfMonths?r.rfMonths+"m":"—" },
      { id:"rfRemaining",  label:"RF Remaining (Months)",w:160,render:r=>r.rfRemaining?r.rfRemaining+"m":"—" },
      { id:"rf1Start",     label:"RF 1 Start",         w:110, render:r=>fmt.date(r.rf1Start) },
      { id:"rf1End",       label:"RF 1 End",           w:110, render:r=>fmt.date(r.rf1End) },
      { id:"rfInfo",       label:"RF Notes",           w:200, render:r=>r.rfInfo },
    ]
  },
  {
    id:"guarantee", label:"Guarantees & Deposits", color:"#F5F3FF",
    cols:[
      { id:"hasGuarantee", label:"Has Guarantee",      w:110, render:r=>r.hasGuarantee===1?<Pill c="purple">Yes</Pill>:"—" },
      { id:"guarantorName",label:"Guarantor",          w:160, render:r=>r.guarantorName },
      { id:"guaranteeFrom",label:"Valid From",         w:110, render:r=>fmt.date(r.guaranteeFrom) },
      { id:"guaranteeTo",  label:"Valid To",           w:110, render:r=>fmt.date(r.guaranteeTo) },
      { id:"guaranteeAmt", label:"Amount PA",          w:120, render:r=>fmt.currency(r.guaranteeAmt,""), align:"right" },
      { id:"securityMonths",label:"Deposit (months)",  w:130, render:r=>r.securityMonths?r.securityMonths+"m":"—" },
    ]
  },
  {
    id:"opex", label:"Operating Expenses", color:"#FFF0F0",
    cols:[
      { id:"opexPA",       label:"OpEx PA (LCY)",      w:130, render:r=>fmt.currency(r.opexPA,""), align:"right" },
      { id:"inPlaceNOI",   label:"In-Place NOI",       w:130, render:r=>fmt.currency(r.inPlaceNOI,""), align:"right" },
      { id:"netLeaseType", label:"Net Lease Type",     w:130, render:r=>r.netLeaseType },
    ]
  },
  {
    id:"flags", label:"Flags & Checks", color:"#FEF2F2",
    cols:[
      { id:"_flag",        label:"Status",             w:130, render:r=><StatusFlag row={r} /> },
      { id:"_actions",     label:"Action Required",    w:160, render:r=><ActionFlag row={r} /> },
    ]
  },
];

// ── flag logic ──────────────────────────────────────────────────────────────
function StatusFlag({ row }) {
  if (row.occupancy === 0) return <Pill c="red">Vacant</Pill>;
  if (row.negotiation === 1) return <Pill c="amber">Negotiating</Pill>;
  if (row.openEnded === 1)   return <Pill c="amber">Open-ended</Pill>;
  const exp = fmt.days(row.leaseExpiry);
  if (exp !== null && exp < 0) return <Pill c="red">Expired</Pill>;
  if (exp !== null && exp < 365) return <Pill c="amber">Exp. &lt;1yr</Pill>;
  return <Pill c="green">Active</Pill>;
}
function ActionFlag({ row }) {
  const items = [];
  const b1 = fmt.days(row.break1Date);
  if (b1 !== null && b1 < 0) items.push("Break passed");
  else if (b1 !== null && b1 < 180) items.push("Break notice due");
  const nr = fmt.days(row.nextReview);
  if (nr !== null && nr < 0) items.push("Review overdue");
  else if (nr !== null && nr < 90) items.push("Review due");
  const ni = fmt.days(row.nextIndexDate);
  if (ni !== null && ni < 0) items.push("Indexation overdue");
  else if (ni !== null && ni < 90) items.push("Indexation due");
  if (items.length === 0) return <span style={{color:"#aaa",fontSize:12}}>—</span>;
  return <div style={{display:"flex",flexDirection:"column",gap:2}}>{items.map(i=><Pill key={i} c={i.includes("overdue")||i.includes("passed")?"red":"amber"}>{i}</Pill>)}</div>;
}

function Pill({c, children}) {
  const map = { green:["#F0FDF4","#166534"], red:["#FEF2F2","#991B1B"], amber:["#FFFBEB","#92400E"], purple:["#F5F3FF","#5B21B6"], teal:["#F0FDFA","#0F766E"], blue:["#EFF6FF","#1D4ED8"] };
  const [bg,text] = map[c]||map.blue;
  return <span style={{fontSize:11,padding:"2px 7px",borderRadius:20,background:bg,color:text,fontWeight:500,whiteSpace:"nowrap"}}>{children}</span>;
}

// ── seed data (representative, ~20 rows) ───────────────────────────────────
function makeSeed() {
  const assets = [
    {assetId:"BX-1001",assetName:"Logistics Park A",country:"UK",city:"Birmingham",portfolio:"BREP IX",fund:"BREP",subMarket:"West Midlands",address:"Unit 1, Midlands Logistics Park, B1 1AA"},
    {assetId:"BX-1002",assetName:"Distribution Centre B",country:"Germany",city:"Frankfurt",portfolio:"BREP IX",fund:"BREP",subMarket:"Rhine-Main",address:"Industriestr. 22, 60313 Frankfurt"},
    {assetId:"BX-1003",assetName:"Warehouse Complex C",country:"France",city:"Lyon",portfolio:"BREP X",fund:"BREP",subMarket:"Grand Lyon",address:"Zone Industrielle Est, 69100 Villeurbanne"},
    {assetId:"BX-1004",assetName:"Urban Logistics D",country:"UK",city:"London",portfolio:"BPP",fund:"BPP",subMarket:"East London",address:"12 Silvertown Way, E16 1EA"},
  ];
  const tenants = [
    {tenantName:"DHL Supply Chain Ltd",tenantTrade:"DHL",tenantIndustry:"Logistics",tenantParent:"Deutsche Post DHL",currency:"GBP"},
    {tenantName:"Amazon EU SARL",tenantTrade:"Amazon",tenantIndustry:"E-Commerce",tenantParent:"Amazon.com Inc",currency:"GBP"},
    {tenantName:"XPO Logistics Europe SA",tenantTrade:"XPO",tenantIndustry:"Logistics",tenantParent:"XPO Inc",currency:"EUR"},
    {tenantName:"Kuehne + Nagel GmbH",tenantTrade:"K+N",tenantIndustry:"Freight",tenantParent:"Kuehne + Nagel International",currency:"EUR"},
    {tenantName:"Geodis SA",tenantTrade:"Geodis",tenantIndustry:"Logistics",tenantParent:"SNCF Group",currency:"EUR"},
    {tenantName:"CEVA Logistics AG",tenantTrade:"CEVA",tenantIndustry:"Logistics",tenantParent:"CMA CGM",currency:"GBP"},
    {tenantName:"Wincanton plc",tenantTrade:"Wincanton",tenantIndustry:"Supply Chain",tenantParent:null,currency:"GBP"},
    {tenantName:"Rhenus SE & Co. KG",tenantTrade:"Rhenus",tenantIndustry:"Logistics",tenantParent:"Rethmann SE",currency:"EUR"},
  ];
  const rows = [];
  let id = 1;
  const today = new Date("2026-04-23");
  const leases = [
    {areaSqm:14233,contractedPA:1198130,passingPA:1195572,ervPA:1320000,leaseStart:"2020-01-01",leaseExpiry:"2028-12-31",break1Date:"2026-06-30",break1Notice:6,break1Holder:"Tenant",nextReview:"2026-06-01",reviewType:"OMV",reviewFreq:60,hasIndex:0,occupancy:1,wale:2.7,walb:0.2},
    {areaSqm:22178,contractedPA:1209924,passingPA:1219790,ervPA:1400000,leaseStart:"2023-10-01",leaseExpiry:"2026-09-30",break1Date:"2026-03-30",break1Notice:6,break1Holder:"Tenant",nextReview:null,reviewType:"Fixed Steps",reviewFreq:null,hasIndex:1,indexName:"CPI",lastIndexDate:"2025-10-01",nextIndexDate:"2026-04-01",indexFloor:0,indexCap:5,occupancy:1,wale:0.4,walb:null},
    {areaSqm:19383,contractedPA:955891,passingPA:1027383,ervPA:980000,leaseStart:"2014-05-15",leaseExpiry:"2027-05-31",break1Date:null,nextReview:"2026-06-01",reviewType:"OMV",reviewFreq:60,hasIndex:0,occupancy:1,wale:1.1,walb:null},
    {areaSqm:9549,contractedPA:485984,passingPA:458352,ervPA:510000,leaseStart:"2022-05-01",leaseExpiry:"2031-12-31",break1Date:"2028-12-31",break1Notice:9,break1Holder:"Mutual",nextReview:"2027-05-01",reviewType:"OMV",reviewFreq:60,hasIndex:0,occupancy:1,wale:5.7,walb:2.7},
    {areaSqm:4980,contractedPA:239637,passingPA:241858,ervPA:260000,leaseStart:"2024-10-01",leaseExpiry:"2027-09-30",break1Date:null,nextReview:null,reviewType:"Index",reviewFreq:12,hasIndex:1,indexName:"CPI",lastIndexDate:"2025-10-01",nextIndexDate:"2026-10-01",indexFloor:0,indexCap:3,occupancy:1,wale:1.4,walb:null},
    {areaSqm:20675,contractedPA:1125732,passingPA:1343875,ervPA:1250000,leaseStart:"2013-01-01",leaseExpiry:"2027-03-02",break1Date:null,nextReview:"2026-01-01",reviewType:"OMV",reviewFreq:60,hasIndex:0,occupancy:1,wale:0.9,walb:null},
    {areaSqm:8797,contractedPA:575038,passingPA:615790,ervPA:620000,leaseStart:"2022-07-01",leaseExpiry:"2028-06-30",break1Date:"2027-12-30",break1Notice:6,break1Holder:"Tenant",nextReview:"2025-07-01",reviewType:"OMV",reviewFreq:36,hasIndex:0,occupancy:1,wale:2.2,walb:1.7},
    {areaSqm:19400,contractedPA:1475858,passingPA:1455000,ervPA:1500000,leaseStart:"2025-02-01",leaseExpiry:"2031-01-31",break1Date:null,nextReview:"2027-02-01",reviewType:"OMV",reviewFreq:24,hasIndex:0,occupancy:1,wale:4.8,walb:null,rfMonths:6,rf1Start:"2025-02-01",rf1End:"2025-08-01"},
    {areaSqm:5390,contractedPA:320209,passingPA:377300,ervPA:340000,leaseStart:"2016-04-01",leaseExpiry:"2026-09-02",break1Date:"2026-03-02",break1Notice:6,break1Holder:"Tenant",nextReview:null,reviewType:"None",hasIndex:1,indexName:"RPI",lastIndexDate:"2025-04-01",nextIndexDate:"2026-04-01",indexFloor:0,indexCap:4,occupancy:1,wale:0.4,walb:null},
    {areaSqm:13673,contractedPA:730211,passingPA:957110,ervPA:820000,leaseStart:"2014-04-01",leaseExpiry:"2026-03-31",break1Date:null,nextReview:null,reviewType:"None",hasIndex:0,occupancy:1,wale:0,walb:null,negotiation:1},
    {areaSqm:5800,contractedPA:306777,passingPA:406000,ervPA:350000,leaseStart:"2014-08-01",leaseExpiry:"2026-03-31",break1Date:null,nextReview:null,reviewType:"None",hasIndex:0,occupancy:0,vacantSince:"2026-04-01"},
    {areaSqm:6053,contractedPA:291270,passingPA:283280,ervPA:300000,leaseStart:"2024-10-01",leaseExpiry:"2027-09-30",break1Date:null,nextReview:null,reviewType:"Index",reviewFreq:12,hasIndex:1,indexName:"CPI",lastIndexDate:"2025-10-01",nextIndexDate:"2026-10-01",indexFloor:0,indexCap:3,occupancy:1,wale:1.4,walb:null},
    {areaSqm:15942,contractedPA:902954,passingPA:793911,ervPA:950000,leaseStart:"2008-09-18",leaseExpiry:"2026-10-31",break1Date:null,nextReview:"2026-05-01",reviewType:"OMV",reviewFreq:60,hasIndex:0,occupancy:1,wale:0.5,walb:null},
    {areaSqm:9953,contractedPA:618065,passingPA:544727,ervPA:660000,leaseStart:"2008-10-31",leaseExpiry:"2026-10-31",break1Date:null,nextReview:"2026-05-01",reviewType:"OMV",reviewFreq:60,hasIndex:0,occupancy:1,wale:0.5,walb:null},
    {areaSqm:12564,contractedPA:401042,passingPA:675048,ervPA:500000,leaseStart:"2008-06-25",leaseExpiry:"2028-12-31",break1Date:null,nextReview:"2026-02-01",reviewType:"OMV",reviewFreq:60,hasIndex:0,occupancy:1,wale:2.7,walb:null},
    {areaSqm:2047,contractedPA:71410,passingPA:143290,ervPA:100000,leaseStart:"2016-06-01",leaseExpiry:"2026-03-31",break1Date:null,nextReview:null,reviewType:"None",hasIndex:0,occupancy:0,vacantSince:"2026-04-01"},
    {areaSqm:9267,contractedPA:295802,passingPA:417993,ervPA:330000,leaseStart:"2009-03-15",leaseExpiry:"2028-12-31",break1Date:null,nextReview:"2026-02-28",reviewType:"OMV",reviewFreq:60,hasIndex:0,occupancy:1,wale:2.7,walb:null},
    {areaSqm:10180,contractedPA:384674,passingPA:459191,ervPA:420000,leaseStart:"2022-02-28",leaseExpiry:"2028-12-31",break1Date:null,nextReview:"2026-02-28",reviewType:"OMV",reviewFreq:60,hasIndex:0,occupancy:1,wale:2.7,walb:null},
    {areaSqm:780,contractedPA:53357,passingPA:54600,ervPA:58000,leaseStart:"2014-08-01",leaseExpiry:"2026-03-31",break1Date:null,nextReview:null,reviewType:"Index",reviewFreq:12,hasIndex:1,indexName:"RPI",nextIndexDate:"2026-08-01",indexFloor:0,indexCap:5,occupancy:1,wale:0,walb:null},
    {areaSqm:1114,contractedPA:39799,passingPA:77980,ervPA:55000,leaseStart:"2017-10-01",leaseExpiry:"2026-03-31",break1Date:null,nextReview:null,reviewType:"None",hasIndex:0,occupancy:0,vacantSince:"2026-04-01"},
  ];
  leases.forEach((l, i) => {
    const asset = assets[i % assets.length];
    const tenant = tenants[i % tenants.length];
    rows.push({
      id: id++,
      ...asset,
      unitId: `${asset.assetId}-U${String(i+1).padStart(2,"0")}`,
      demiseId: `DEM-${String(10000+i).padStart(5,"0")}`,
      tenantId: `TEN-${String(2000+i).padStart(5,"0")}`,
      leaseId:  `LSE-${String(3000+i).padStart(5,"0")}`,
      useType: "Logistics",
      warehouseSqm: l.areaSqm ? Math.round(l.areaSqm * 0.85) : null,
      officeSqm:    l.areaSqm ? Math.round(l.areaSqm * 0.1) : null,
      mezzanineSqm: null,
      openEnded: (!l.leaseExpiry || new Date(l.leaseExpiry) < today) && l.occupancy === 1 && l.negotiation !== 1 && !l.vacantSince ? 0 : 0,
      hasGuarantee: i % 3 === 0 ? 1 : 0,
      guarantorName: i % 3 === 0 ? tenant.tenantParent : null,
      guaranteeFrom: i % 3 === 0 ? l.leaseStart : null,
      guaranteeTo:   i % 3 === 0 ? l.leaseExpiry : null,
      guaranteeAmt:  i % 3 === 0 ? Math.round(l.contractedPA * 0.5) : null,
      securityMonths: i % 4 === 0 ? 3 : null,
      opexPA: Math.round(l.areaSqm * (i%2===0?18:22)),
      inPlaceNOI: l.passingPA ? Math.round(l.passingPA - l.areaSqm*(i%2===0?18:22)) : null,
      netLeaseType: i % 3 === 0 ? "Triple Net" : i % 3 === 1 ? "Double Net" : "Single Net",
      companyNum: `${String(Math.floor(Math.random()*9000000)+1000000)}`,
      ...tenant,
      ...l,
    });
  });
  return rows;
}

const SEED_DATA = makeSeed();

// ── action queue logic ──────────────────────────────────────────────────────
function deriveActions(leases) {
  const actions = [];
  leases.forEach(row => {
    const b1 = fmt.days(row.break1Date);
    if (b1 !== null && b1 < 0 && !row._breakResolved) {
      actions.push({ id:`b-${row.id}`, type:"break", leaseId:row.id, tenant:row.tenantName, asset:row.assetName, unit:row.unitId, date:row.break1Date, title:`Break date passed — ${row.tenantName}`, desc:`The break date of ${fmt.date(row.break1Date)} has passed. Please confirm whether notice was served within the required ${row.break1Notice||6}-month notice period.` });
    }
    const nr = fmt.days(row.nextReview);
    if (nr !== null && nr < 0 && !row._reviewResolved) {
      actions.push({ id:`r-${row.id}`, type:"review", leaseId:row.id, tenant:row.tenantName, asset:row.assetName, unit:row.unitId, date:row.nextReview, title:`Rent review overdue — ${row.tenantName}`, desc:`OMV rent review due ${fmt.date(row.nextReview)} is outstanding. Please confirm the agreed new rent or note that review is in progress.` });
    }
    const ni = fmt.days(row.nextIndexDate);
    if (ni !== null && ni < 30 && !row._indexResolved) {
      actions.push({ id:`i-${row.id}`, type:"indexation", leaseId:row.id, tenant:row.tenantName, asset:row.assetName, unit:row.unitId, date:row.nextIndexDate, title:`Indexation ${ni < 0 ? "overdue" : "due"} — ${row.tenantName}`, desc:`${row.indexName||"CPI"} indexation ${ni<0?"was due":"is due"} ${fmt.date(row.nextIndexDate)}. Upload the indexation notice or enter the new rent figure to update the roll.` });
    }
  });
  return actions;
}

const EXTRACT_PROMPT = `You are a specialist commercial property solicitor and lease analyst for an institutional real estate fund. Extract key lease data from this document and return ONLY a valid JSON object — no preamble, no markdown, no backticks.

Schema:
{
  "assetName": string, "country": string, "city": string, "address": string,
  "tenantName": string, "tenantTrade": string or null, "tenantIndustry": string or null, "tenantParent": string or null, "companyNum": string or null,
  "currency": "GBP"|"EUR"|"USD"|string,
  "useType": "Logistics"|"Office"|"Retail"|"Industrial"|"Other",
  "areaSqm": number or null, "warehouseSqm": number or null, "officeSqm": number or null,
  "leaseStart": "YYYY-MM-DD" or null, "leaseExpiry": "YYYY-MM-DD" or null,
  "contractedPA": number (annual, in lease currency) or null,
  "passingPA": number (annual, net of incentives) or null,
  "ervPA": number or null,
  "reviewType": "OMV"|"CPI"|"RPI"|"Fixed Steps"|"Index"|"Combined"|"None",
  "reviewFreq": number (months) or null, "lastReview": "YYYY-MM-DD" or null, "nextReview": "YYYY-MM-DD" or null, "upwardsOnly": 0|1,
  "break1Date": "YYYY-MM-DD" or null, "break1Notice": number (months) or null, "break1Holder": "Tenant"|"Landlord"|"Mutual"|null,
  "break2Date": "YYYY-MM-DD" or null,
  "hasIndex": 0|1, "indexName": "CPI"|"RPI"|"HICP"|null, "lastIndexDate": "YYYY-MM-DD" or null, "nextIndexDate": "YYYY-MM-DD" or null, "indexFloor": number or null, "indexCap": number or null,
  "rfMonths": number or null, "rf1Start": "YYYY-MM-DD" or null, "rf1End": "YYYY-MM-DD" or null,
  "hasGuarantee": 0|1, "guarantorName": string or null, "guaranteeFrom": "YYYY-MM-DD" or null, "guaranteeTo": "YYYY-MM-DD" or null, "guaranteeAmt": number or null,
  "securityMonths": number or null, "netLeaseType": "Triple Net"|"Double Net"|"Single Net"|"Gross"|null,
  "openEnded": 0|1, "negotiation": 0|1,
  "confidence": { "tenantName":"high"|"medium"|"low", "leaseExpiry":"high"|"medium"|"low", "contractedPA":"high"|"medium"|"low", "break1Date":"high"|"medium"|"low", "nextReview":"high"|"medium"|"low", "nextIndexDate":"high"|"medium"|"low" },
  "extractionNotes": string,
  "sources": {
    "tenantName":    {"section": string, "pageRef": string, "clauseText": string},
    "contractedPA":  {"section": string, "pageRef": string, "clauseText": string},
    "passingPA":     {"section": string, "pageRef": string, "clauseText": string},
    "leaseStart":    {"section": string, "pageRef": string, "clauseText": string},
    "leaseExpiry":   {"section": string, "pageRef": string, "clauseText": string},
    "break1Date":    {"section": string, "pageRef": string, "clauseText": string},
    "nextReview":    {"section": string, "pageRef": string, "clauseText": string},
    "reviewType":    {"section": string, "pageRef": string, "clauseText": string},
    "hasIndex":      {"section": string, "pageRef": string, "clauseText": string},
    "hasGuarantee":  {"section": string, "pageRef": string, "clauseText": string},
    "rfMonths":      {"section": string, "pageRef": string, "clauseText": string}
  }
}`;

// ── main ────────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession]     = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView]           = useState("roll");
  const [leases, setLeases]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selectedLease, setSelectedLease] = useState(null);
  const [actionModal, setActionModal] = useState(null);
  const [modalInputs, setModalInputs] = useState({});
  const [clausePanel, setClausePanel] = useState(null); // {fieldId, fieldLabel, source}
  const [currentUser] = useState(TEAM[0]); // in production this would come from auth

  // Auth session listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setAuthLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if(session) loadLeases(); }, [session]);

  async function loadLeases() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("leases").select("*, approval_log(*)").order("created_at", { ascending: false });
      if (error) throw error;
      setLeases(data && data.length > 0 ? data.map(dbToApp) : SEED_DATA);
    } catch(err) {
      console.error("DB load error:", err);
      setLeases(SEED_DATA);
    }
    setLoading(false);
  }

  function dbToApp(r) {
    return {
      id:r.id, assetId:r.asset_id_text||"", assetName:r.asset_name, country:r.country,
      city:r.city, portfolio:r.portfolio, fund:r.fund, subMarket:r.sub_market, address:r.address,
      unitId:r.unit_id, demiseId:r.demise_id, tenantId:r.tenant_id, leaseId:r.lease_id,
      tenantName:r.tenant_name, tenantTrade:r.tenant_trade, tenantIndustry:r.tenant_industry,
      tenantParent:r.tenant_parent, companyNum:r.company_num, useType:r.use_type,
      areaSqm:r.area_sqm, warehouseSqm:r.warehouse_sqm, officeSqm:r.office_sqm,
      mezzanineSqm:r.mezzanine_sqm, occupancy:r.occupancy, vacantSince:r.vacant_since,
      currency:r.currency, contractedPA:r.contracted_pa, passingPA:r.passing_pa, ervPA:r.erv_pa,
      leaseStart:r.lease_start, leaseExpiry:r.lease_expiry, wale:r.wale, walb:r.walb,
      openEnded:r.open_ended, negotiation:r.negotiation, leaseStatus:r.lease_status,
      break1Date:r.break1_date, break1Notice:r.break1_notice, break1Holder:r.break1_holder,
      break2Date:r.break2_date, break2Notice:r.break2_notice, breakInfo:r.break_info,
      reviewType:r.review_type, reviewFreq:r.review_freq, lastReview:r.last_review,
      nextReview:r.next_review, upwardsOnly:r.upwards_only, reviewInfo:r.review_info,
      hasIndex:r.has_index, indexName:r.index_name, lastIndexDate:r.last_index_date,
      lastIndexRate:r.last_index_rate, nextIndexDate:r.next_index_date,
      indexFloor:r.index_floor, indexCap:r.index_cap, rfMonths:r.rf_months,
      rfRemaining:r.rf_remaining, rf1Start:r.rf1_start, rf1End:r.rf1_end, rfInfo:r.rf_info,
      hasGuarantee:r.has_guarantee, guarantorName:r.guarantor_name, guaranteeFrom:r.guarantee_from,
      guaranteeTo:r.guarantee_to, guaranteeAmt:r.guarantee_amt, securityMonths:r.security_months,
      opexPA:r.opex_pa, inPlaceNOI:r.in_place_noi, netLeaseType:r.net_lease_type,
      sources:r.sources||{},
      approvalLog:(r.approval_log||[]).map(l=>({
        id:l.id, actionType:l.action_type, outcome:l.outcome, approver:l.approver_name,
        approverRole:l.approver_role, date:l.created_at?.slice(0,10),
        timestamp:l.created_at?.slice(11,16), note:l.note, docName:l.doc_name,
        newRent:l.new_rent, eventDate:l.event_date, eventTitle:l.event_title,
      })),
      _breakResolved:r.break_resolved, _reviewResolved:r.review_resolved, _indexResolved:r.index_resolved,
    };
  }

  function appToDB(d) {
    return {
      asset_name:d.assetName, country:d.country, city:d.city, portfolio:d.portfolio,
      fund:d.fund, sub_market:d.subMarket, address:d.address, unit_id:d.unitId,
      demise_id:d.demiseId, tenant_id:d.tenantId, lease_id:d.leaseId,
      tenant_name:d.tenantName, tenant_trade:d.tenantTrade, tenant_industry:d.tenantIndustry,
      tenant_parent:d.tenantParent, company_num:d.companyNum, use_type:d.useType,
      area_sqm:d.areaSqm, warehouse_sqm:d.warehouseSqm, office_sqm:d.officeSqm,
      mezzanine_sqm:d.mezzanineSqm, occupancy:d.occupancy??1, vacant_since:d.vacantSince,
      currency:d.currency||"GBP", contracted_pa:d.contractedPA, passing_pa:d.passingPA,
      erv_pa:d.ervPA, lease_start:d.leaseStart, lease_expiry:d.leaseExpiry,
      wale:d.wale, walb:d.walb, open_ended:d.openEnded??0, negotiation:d.negotiation??0,
      lease_status:d.leaseStatus, break1_date:d.break1Date, break1_notice:d.break1Notice,
      break1_holder:d.break1Holder, break2_date:d.break2Date, break2_notice:d.break2Notice,
      break_info:d.breakInfo, review_type:d.reviewType, review_freq:d.reviewFreq,
      last_review:d.lastReview, next_review:d.nextReview, upwards_only:d.upwardsOnly??1,
      review_info:d.reviewInfo, has_index:d.hasIndex??0, index_name:d.indexName,
      last_index_date:d.lastIndexDate, last_index_rate:d.lastIndexRate,
      next_index_date:d.nextIndexDate, index_floor:d.indexFloor, index_cap:d.indexCap,
      rf_months:d.rfMonths, rf_remaining:d.rfRemaining, rf1_start:d.rf1Start, rf1_end:d.rf1End,
      rf_info:d.rfInfo, has_guarantee:d.hasGuarantee??0, guarantor_name:d.guarantorName,
      guarantee_from:d.guaranteeFrom, guarantee_to:d.guaranteeTo, guarantee_amt:d.guaranteeAmt,
      security_months:d.securityMonths, opex_pa:d.opexPA, in_place_noi:d.inPlaceNOI,
      net_lease_type:d.netLeaseType, sources:d.sources||{},
    };
  }
  const [toast, setToast]         = useState(null);
  const [uploadStage, setUploadStage] = useState("drop");
  const [uploadedFile, setUploadedFile] = useState(null);
  const [editedData, setEditedData] = useState(null);
  const [extractError, setExtractError] = useState(null);
  const [visibleGroups, setVisibleGroups] = useState(()=>{
    const m = {}; COLUMN_GROUPS.forEach(g=>m[g.id]=true); return m;
  });
  const [filters, setFilters]     = useState({ search:"", country:"", status:"", fund:"" });
  const [sortCol, setSortCol]     = useState(null);
  const [sortDir, setSortDir]     = useState("asc");
  const [frozenCols]              = useState(2);
  const fileInputRef = useRef();
  const tableRef = useRef();

  const actions = useMemo(() => deriveActions(leases), [leases]);

  function showToast(msg, type="success") { setToast({msg,type}); setTimeout(()=>setToast(null),3500); }

  const filtered = useMemo(() => {
    let rows = [...leases];
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter(r=>[r.tenantName,r.assetName,r.unitId,r.address].some(v=>v&&v.toLowerCase().includes(q)));
    }
    if (filters.country) rows = rows.filter(r=>r.country===filters.country);
    if (filters.fund)    rows = rows.filter(r=>r.fund===filters.fund);
    if (filters.status === "vacant")   rows = rows.filter(r=>r.occupancy===0);
    if (filters.status === "active")   rows = rows.filter(r=>r.occupancy===1);
    if (filters.status === "expiring") rows = rows.filter(r=>{ const d=fmt.days(r.leaseExpiry); return d!==null&&d>=0&&d<365; });
    if (filters.status === "action")   rows = rows.filter(r=>actions.some(a=>a.leaseId===r.id));
    if (sortCol) rows.sort((a,b)=>{ const v1=a[sortCol]??0, v2=b[sortCol]??0; return sortDir==="asc"?(v1>v2?1:-1):(v1<v2?1:-1); });
    return rows;
  }, [leases, filters, sortCol, sortDir, actions]);

  const metrics = useMemo(() => {
    const occupied = leases.filter(r=>r.occupancy===1);
    const totalRent = occupied.reduce((s,r)=>s+(r.passingPA||0),0);
    const totalArea = leases.reduce((s,r)=>s+(r.areaSqm||0),0);
    const occupiedArea = occupied.reduce((s,r)=>s+(r.areaSqm||0),0);
    const totalERV = leases.reduce((s,r)=>s+(r.ervPA||0),0);
    return { totalRent, totalArea, occupiedArea, totalERV, occ: totalArea>0?occupiedArea/totalArea*100:0, leaseCount:leases.length, occupiedCount:occupied.length, actionCount:actions.length };
  }, [leases, actions]);

  const allCols = useMemo(() => COLUMN_GROUPS.filter(g=>visibleGroups[g.id]).flatMap(g=>g.cols), [visibleGroups]);
  const countries = [...new Set(leases.map(r=>r.country).filter(Boolean))];
  const funds = [...new Set(leases.map(r=>r.fund).filter(Boolean))];

  // ── resolve action ──────────────────────────────────────────────────────
  async function resolveAction(action, resolution) {
    const approver = TEAM.find(t=>t.id===resolution.approverId) || currentUser;
    const logEntry = {
      id: Date.now(),
      actionType: action.type,
      outcome: resolution.outcome || (resolution.newRent ? "rent_updated" : "resolved"),
      approver: approver.name,
      approverRole: approver.role,
      date: new Date().toISOString().slice(0,10),
      timestamp: new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}),
      note: resolution.note || "",
      docName: resolution.docName || null,
      newRent: resolution.newRent || null,
      eventDate: action.date,
      eventTitle: action.title,
    };
    // Save approval log entry to Supabase
    try {
      await supabase.from("approval_log").insert([{
        lease_id: action.leaseId,
        action_type: logEntry.actionType,
        outcome: logEntry.outcome,
        approver_name: logEntry.approver,
        approver_role: logEntry.approverRole,
        note: logEntry.note,
        doc_name: logEntry.docName,
        new_rent: logEntry.newRent ? Number(logEntry.newRent) : null,
        event_date: logEntry.eventDate,
        event_title: logEntry.eventTitle,
      }]);
      // Update lease record in Supabase
      const leaseUpdates = {};
      if(resolution.type==="break"||action.type==="break") {
        leaseUpdates.break_resolved = true;
        if(resolution.outcome==="served") leaseUpdates.lease_expiry = action.date;
      }
      if((action.type==="review") && resolution.newRent) {
        leaseUpdates.passing_pa = Number(resolution.newRent);
        leaseUpdates.review_resolved = true;
        leaseUpdates.next_review = null;
      }
      if(action.type==="indexation" && resolution.newRent) {
        leaseUpdates.passing_pa = Number(resolution.newRent);
        leaseUpdates.index_resolved = true;
        leaseUpdates.next_index_date = null;
      }
      if(Object.keys(leaseUpdates).length > 0) {
        await supabase.from("leases").update(leaseUpdates).eq("id", action.leaseId);
      }
    } catch(err) { console.error("Supabase update error:", err); }

    setLeases(prev=>prev.map(l=>{
      if(l.id!==action.leaseId) return l;
      const up = { approvalLog: [...(l.approvalLog||[]), logEntry] };
      if(action.type==="break") {
        if(resolution.outcome==="not_served") up._breakResolved=true;
        else { up._breakResolved=true; up.leaseExpiry=l.break1Date; up.openEnded=0; }
      }
      if(action.type==="review" && resolution.newRent) {
        up.passingPA=Number(resolution.newRent); up._reviewResolved=true;
        up.lastReview=l.nextReview; up.nextReview=null;
      }
      if(action.type==="indexation" && resolution.newRent) {
        up.passingPA=Number(resolution.newRent); up._indexResolved=true;
        up.lastIndexDate=l.nextIndexDate; up.nextIndexDate=null;
      }
      return {...l,...up};
    }));
    setActionModal(null); setModalInputs({});
    showToast("Action approved by " + approver.name + " and rent roll updated.");
  }

  // ── file upload ─────────────────────────────────────────────────────────
  async function handleFile(file) {
    if (!file) return;
    setUploadedFile(file); setExtractError(null); setUploadStage("reading");
    try {
      const b64 = await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=()=>rej(new Error("Read error"));r.readAsDataURL(file);});
      setUploadStage("extracting");
      const isPdf   = file.type==="application/pdf"||file.name.toLowerCase().endsWith(".pdf");
      const isImage = ["image/jpeg","image/jpg","image/png","image/gif","image/webp"].includes(file.type)||/\.(jpe?g|png|gif|webp|tiff?)$/i.test(file.name);
      const imgType = file.type.startsWith("image/") ? file.type : "image/jpeg";
      const messages = isPdf
        ? [{role:"user",content:[{type:"document",source:{type:"base64",media_type:"application/pdf",data:b64}},{type:"text",text:EXTRACT_PROMPT}]}]
        : isImage
        ? [{role:"user",content:[{type:"image",source:{type:"base64",media_type:imgType,data:b64}},{type:"text",text:EXTRACT_PROMPT}]}]
        : [{role:"user",content:[{type:"text",text:`Lease document (${file.name}):\n\n${atob(b64).substring(0,25000)}\n\n${EXTRACT_PROMPT}`}]}];
      const resp = await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:4000,messages})});
      if(!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();
      const raw = data.content.map(b=>b.text||"").join("").trim();
      let clean = raw.replace(/^```json\s*/i,"").replace(/^```\s*/i,"").replace(/```\s*$/,"").trim();
      const objMatch = clean.match(/\{[\s\S]*\}/);
      if(objMatch) clean = objMatch[0];
      let parsed;
      try { parsed = JSON.parse(clean); }
      catch(e) {
        let s = clean;
        const opens = (s.match(/\{/g)||[]).length, closes = (s.match(/\}/g)||[]).length;
        const openArr = (s.match(/\[/g)||[]).length - (s.match(/\]/g)||[]).length;
        if(/[^\"]"[^"]*$/.test(s)) s += '"';
        s += "]".repeat(Math.max(0,openArr)) + "}".repeat(Math.max(0,opens-closes));
        try { parsed = JSON.parse(s); }
        catch(e2) { throw new Error("Could not parse extraction response — try uploading a clearer image or PDF version of the lease."); }
      }
      setEditedData(parsed); setUploadStage("review");
    } catch(err) { setExtractError(err.message); setUploadStage("drop"); }
  }

  async function commitLease() {
    const d = editedData||{};
    const count = leases.length + 1;
    const newLease = {
      ...d,
      unitId: d.unitId || `${d.assetName||"NEW"}-U${String(count).padStart(2,"0")}`,
      demiseId: d.demiseId || `DEM-${String(10000+count).padStart(5,"0")}`,
      tenantId: d.tenantId || `TEN-${String(2000+count).padStart(5,"0")}`,
      leaseId: d.leaseId || `LSE-${String(3000+count).padStart(5,"0")}`,
      useType: d.useType || "Logistics",
      occupancy: 1,
      sources: d.sources || {},
      approvalLog: [],
    };
    try {
      const { data, error } = await supabase
        .from("leases")
        .insert([appToDB(newLease)])
        .select()
        .single();
      if (error) throw error;
      setLeases(prev => [...prev, { ...newLease, id: data.id }]);
      showToast("Lease saved to database.");
    } catch(err) {
      console.error("Save error:", err);
      setLeases(prev => [...prev, { ...newLease, id: Date.now() }]);
      showToast("Lease added (offline mode).");
    }
    setView("roll"); setUploadStage("drop"); setUploadedFile(null); setEditedData(null);
  }

  const confColor = c => c==="high"?{bg:"#F0FDF4",tc:"#166534",bc:"#BBF7D0"}:c==="medium"?{bg:"#FFFBEB",tc:"#92400E",bc:"#FDE68A"}:{bg:"#FEF2F2",tc:"#991B1B",bc:"#FECACA"};

  // ── render ──────────────────────────────────────────────────────────────
  const nav = [{id:"roll",label:"Rent Roll"},{id:"actions",label:"Action Queue",badge:actions.length},{id:"upload",label:"Add Lease"}];

  if (authLoading) return (
      <div style={{fontFamily:"'DM Sans','Helvetica Neue',sans-serif",minHeight:"100vh",background:"#F8F7F4",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{width:32,height:32,border:"3px solid #E8E6E0",borderTopColor:"#1A1A1A",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}></div>
        <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
      </div>
    );
    if (!session) return <Auth />;

    return (
    <div style={{fontFamily:"'DM Sans','Helvetica Neue',sans-serif",display:"flex",height:"100vh",background:"#F8F7F4",color:"#1A1A1A",fontSize:13}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>

      {/* Sidebar */}
      <aside style={{width:200,background:"#fff",borderRight:"1px solid #E8E6E0",display:"flex",flexDirection:"column",flexShrink:0}}>
        <div style={{padding:"16px 16px 12px",borderBottom:"1px solid #E8E6E0"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:26,height:26,background:"#1A1A1A",borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" fill="white"/><rect x="9" y="2" width="5" height="5" rx="1" fill="white" fillOpacity=".5"/><rect x="2" y="9" width="5" height="5" rx="1" fill="white" fillOpacity=".5"/><rect x="9" y="9" width="5" height="5" rx="1" fill="white"/></svg>
            </div>
            <div>
              <div style={{fontSize:13,fontWeight:600,letterSpacing:"-0.02em"}}>LeaseLedger</div>
              <div style={{fontSize:10,color:"#aaa"}}>Institutional Roll</div>
            </div>
          </div>
        </div>
        <nav style={{padding:"8px 6px",flex:1}}>
          {nav.map(n=>(
            <button key={n.id} onClick={()=>{setView(n.id);if(n.id==="upload")setUploadStage("drop");}}
              style={{width:"100%",display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:7,border:"none",cursor:"pointer",fontSize:13,fontWeight:view===n.id?500:400,background:view===n.id?"#F3F2EE":"transparent",color:view===n.id?"#1A1A1A":"#666",marginBottom:2,textAlign:"left"}}>
              {n.label}
              {n.badge>0&&<span style={{marginLeft:"auto",background:"#EF4444",color:"#fff",fontSize:10,fontWeight:600,borderRadius:10,padding:"1px 6px"}}>{n.badge}</span>}
            </button>
          ))}
        </nav>
        <div style={{padding:"12px 16px",borderTop:"1px solid #E8E6E0"}}>
          <div style={{fontSize:11,color:"#888",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:10,color:"#999"}}>{session?.user?.email?.split("@")[0]}</span>
          <button onClick={()=>supabase.auth.signOut()} style={{fontSize:11,color:"#888",background:"none",border:"1px solid #E8E6E0",borderRadius:5,padding:"2px 8px",cursor:"pointer"}}>Sign out</button>
        </div>
        <div style={{fontSize:10,color:"#999",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>Portfolio summary</div>
          {[["Leases",metrics.leaseCount],["Passing rent",fmt.currency(metrics.totalRent,"")],["Occ. rate",metrics.occ.toFixed(1)+"%"],["Actions",metrics.actionCount]].map(([l,v])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:3,fontSize:11}}>
              <span style={{color:"#888"}}>{l}</span>
              <span style={{fontWeight:500,color:l==="Actions"&&metrics.actionCount>0?"#991B1B":"#1A1A1A"}}>{v}</span>
            </div>
          ))}
        </div>
      </aside>

      {/* Main */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

        {/* Topbar */}
        <header style={{background:"#fff",borderBottom:"1px solid #E8E6E0",padding:"10px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
            <h1 style={{fontSize:15,fontWeight:600,margin:0,whiteSpace:"nowrap"}}>
              {view==="roll"?"Live Rent Roll":view==="actions"?"Action Queue":"Add New Lease"}
            </h1>
            {view==="roll"&&<>
              <span style={{fontSize:11,color:"#aaa"}}>|</span>
              <span style={{fontSize:11,color:"#666"}}>{filtered.length} of {leases.length} leases</span>
            </>}
          </div>
          {view==="roll"&&(
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <input placeholder="Search tenant, asset, address…" value={filters.search} onChange={e=>setFilters(p=>({...p,search:e.target.value}))}
                style={{padding:"6px 10px",border:"1px solid #E8E6E0",borderRadius:7,fontSize:12,width:220,outline:"none",fontFamily:"inherit"}}/>
              <select value={filters.country} onChange={e=>setFilters(p=>({...p,country:e.target.value}))} style={{padding:"6px 8px",border:"1px solid #E8E6E0",borderRadius:7,fontSize:12,fontFamily:"inherit",outline:"none"}}>
                <option value="">All countries</option>
                {countries.map(c=><option key={c}>{c}</option>)}
              </select>
              <select value={filters.status} onChange={e=>setFilters(p=>({...p,status:e.target.value}))} style={{padding:"6px 8px",border:"1px solid #E8E6E0",borderRadius:7,fontSize:12,fontFamily:"inherit",outline:"none"}}>
                <option value="">All statuses</option>
                <option value="active">Occupied</option>
                <option value="vacant">Vacant</option>
                <option value="expiring">Expiring &lt;1yr</option>
                <option value="action">Action required</option>
              </select>
            </div>
          )}
          <div style={{display:"flex",gap:8}}>
            {actions.length>0&&view!=="actions"&&(
              <button onClick={()=>setView("actions")} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 12px",background:"#FEF3C7",border:"1px solid #FDE68A",borderRadius:7,fontSize:12,fontWeight:500,color:"#92400E",cursor:"pointer"}}>
                <span style={{width:6,height:6,background:"#F59E0B",borderRadius:"50%",display:"inline-block"}}></span>{actions.length} action{actions.length!==1?"s":""}
              </button>
            )}
            <button onClick={()=>{setView("upload");setUploadStage("drop");}} style={{padding:"6px 14px",background:"#1A1A1A",color:"#fff",border:"none",borderRadius:7,fontSize:12,fontWeight:500,cursor:"pointer"}}>+ Add lease</button>
          </div>
        </header>

        {/* Metrics bar (roll view only) */}
        {view==="roll"&&(
          <div style={{background:"#fff",borderBottom:"1px solid #E8E6E0",padding:"8px 20px",display:"flex",gap:20,flexShrink:0,overflowX:"auto"}}>
            {[
              {l:"Total passing rent",v:fmt.currency(metrics.totalRent,""),hi:false},
              {l:"Total ERV",v:fmt.currency(metrics.totalERV,""),hi:false},
              {l:"Occupancy",v:metrics.occ.toFixed(1)+"%",hi:false},
              {l:"Occupied leases",v:`${metrics.occupiedCount} / ${metrics.leaseCount}`,hi:false},
              {l:"Total area (SQM)",v:fmt.num(metrics.totalArea),hi:false},
              {l:"Actions required",v:metrics.actionCount,hi:metrics.actionCount>0},
            ].map(m=>(
              <div key={m.l} style={{flexShrink:0}}>
                <div style={{fontSize:10,color:"#999",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:2}}>{m.l}</div>
                <div style={{fontSize:14,fontWeight:600,letterSpacing:"-0.02em",color:m.hi?"#991B1B":"#1A1A1A"}}>{m.v}</div>
              </div>
            ))}
            <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
              <span style={{fontSize:11,color:"#888"}}>Columns:</span>
              {COLUMN_GROUPS.map(g=>(
                <button key={g.id} onClick={()=>setVisibleGroups(p=>({...p,[g.id]:!p[g.id]}))}
                  style={{fontSize:10,padding:"3px 8px",borderRadius:4,border:`1px solid ${visibleGroups[g.id]?"#1A1A1A":"#D1D5DB"}`,background:visibleGroups[g.id]?"#1A1A1A":"#fff",color:visibleGroups[g.id]?"#fff":"#666",cursor:"pointer",fontWeight:500,whiteSpace:"nowrap"}}>
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Content */}
        <main style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>

          {/* ── RENT ROLL TABLE ── */}
          {view==="roll"&&loading&&(
            <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:"#888"}}>
              <div style={{width:32,height:32,border:"3px solid #E8E6E0",borderTopColor:"#1A1A1A",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}></div>
              <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
              <div style={{fontSize:14}}>Loading rent roll from database…</div>
            </div>
          )}
          {view==="roll"&&!loading&&(
            <div ref={tableRef} style={{flex:1,overflowX:"auto",overflowY:"auto"}}>
              <table style={{borderCollapse:"collapse",fontSize:12,minWidth:"100%",tableLayout:"fixed"}}>
                <colgroup>
                  {allCols.map(c=><col key={c.id} style={{width:c.w,minWidth:c.w}}/>)}
                </colgroup>
                <thead style={{position:"sticky",top:0,zIndex:10}}>
                  {/* Group headers */}
                  <tr>
                    {COLUMN_GROUPS.filter(g=>visibleGroups[g.id]).map(g=>(
                      <th key={g.id} colSpan={g.cols.length} style={{background:g.color,border:"1px solid #E8E6E0",padding:"4px 10px",textAlign:"left",fontSize:10,fontWeight:600,color:"#444",letterSpacing:"0.04em",textTransform:"uppercase"}}>
                        {g.label}
                      </th>
                    ))}
                  </tr>
                  {/* Column headers */}
                  <tr>
                    {allCols.map(c=>(
                      <th key={c.id} onClick={()=>{ setSortCol(c.id); setSortDir(p=>sortCol===c.id&&p==="asc"?"desc":"asc"); }}
                        style={{background:"#F8F7F4",border:"1px solid #E8E6E0",padding:"6px 10px",textAlign:c.align||"left",fontSize:10,fontWeight:600,color:"#555",whiteSpace:"nowrap",cursor:"pointer",userSelect:"none",letterSpacing:"0.02em"}}>
                        {c.label}{sortCol===c.id?sortDir==="asc"?" ↑":" ↓":""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row,ri)=>{
                    const hasAction = actions.some(a=>a.leaseId===row.id);
                    return (
                      <tr key={row.id}
                        onClick={()=>setSelectedLease(row)}
                        style={{background:hasAction?"#FFFBEB":ri%2===0?"#fff":"#FAFAF8",cursor:"pointer",borderBottom:"1px solid #F0EEE8"}}
                        onMouseEnter={e=>e.currentTarget.style.background=hasAction?"#FEF3C7":"#F0EEF8"}
                        onMouseLeave={e=>e.currentTarget.style.background=hasAction?"#FFFBEB":ri%2===0?"#fff":"#FAFAF8"}>
                        {allCols.map(c=>(
                          <td key={c.id} style={{padding:"8px 10px",borderRight:"1px solid #F0EEE8",textAlign:c.align||"left",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:c.w,verticalAlign:"middle"}}>
                            {c.render(row)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {filtered.length===0&&(
                    <tr><td colSpan={allCols.length} style={{padding:"40px",textAlign:"center",color:"#aaa"}}>No leases match current filters</td></tr>
                  )}
                  {/* Totals row */}
                  {filtered.length>0&&(
                    <tr style={{background:"#F3F2EE",fontWeight:600,position:"sticky",bottom:0,borderTop:"2px solid #D1D5DB"}}>
                      {allCols.map((c,i)=>(
                        <td key={c.id} style={{padding:"8px 10px",borderRight:"1px solid #E8E6E0",textAlign:c.align||"left",fontSize:11}}>
                          {c.id==="tenantName"?`${filtered.length} leases`:
                           c.id==="contractedPA"?<b>{fmt.currency(filtered.reduce((s,r)=>s+(r.contractedPA||0),0),"")}</b>:
                           c.id==="passingPA"?<b>{fmt.currency(filtered.reduce((s,r)=>s+(r.passingPA||0),0),"")}</b>:
                           c.id==="ervPA"?<b>{fmt.currency(filtered.reduce((s,r)=>s+(r.ervPA||0),0),"")}</b>:
                           c.id==="areaSqm"?<b>{fmt.num(filtered.reduce((s,r)=>s+(r.areaSqm||0),0))}</b>:
                           c.id==="opexPA"?<b>{fmt.currency(filtered.reduce((s,r)=>s+(r.opexPA||0),0),"")}</b>:
                           c.id==="inPlaceNOI"?<b>{fmt.currency(filtered.reduce((s,r)=>s+(r.inPlaceNOI||0),0),"")}</b>:""}
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ── ACTIONS ── */}
          {view==="actions"&&(
            <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>
              <div style={{maxWidth:760}}>
                {actions.length===0?(
                  <div style={{textAlign:"center",padding:"60px 20px",color:"#888"}}><div style={{fontSize:28,marginBottom:10}}>✓</div><div style={{fontSize:15,fontWeight:500}}>All clear — no actions required</div></div>
                ):actions.map(a=>{
                  const typeColor = a.type==="break"?["#FEF2F2","#FECACA","#991B1B"]:a.type==="review"?["#F5F3FF","#DDD6FE","#5B21B6"]:["#FFFBEB","#FDE68A","#92400E"];
                  return (
                    <div key={a.id} style={{background:"#fff",border:"1px solid #E8E6E0",borderRadius:10,padding:"18px 20px",marginBottom:12}}>
                      <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start"}}>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                            <span style={{fontSize:10,padding:"2px 8px",borderRadius:10,background:typeColor[0],border:`1px solid ${typeColor[1]}`,color:typeColor[2],fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em"}}>{a.type}</span>
                            <span style={{fontSize:11,color:"#888"}}>{a.asset} · {a.unit}</span>
                          </div>
                          <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>{a.title}</div>
                          <div style={{fontSize:12,color:"#555",lineHeight:1.6}}>{a.desc}</div>
                        </div>
                        <button onClick={()=>setActionModal(a)} style={{flexShrink:0,padding:"7px 14px",background:"#1A1A1A",color:"#fff",border:"none",borderRadius:7,fontSize:12,fontWeight:500,cursor:"pointer"}}>Resolve →</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── UPLOAD / EXTRACT ── */}
          {view==="upload"&&(
            <div style={{flex:1,overflowY:"auto",padding:"24px 28px"}}>
              <div style={{maxWidth:680}}>
                {uploadStage==="drop"&&<>
                  {extractError&&<div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:8,padding:"12px 16px",marginBottom:16,fontSize:13,color:"#991B1B"}}>✗ {extractError}</div>}
                  <div onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor="#1A1A1A";e.currentTarget.style.background="#F3F2EE";}}
                    onDragLeave={e=>{e.currentTarget.style.borderColor="#D1D5DB";e.currentTarget.style.background="#FAFAF8";}}
                    onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor="#D1D5DB";e.currentTarget.style.background="#FAFAF8";const f=e.dataTransfer?.files?.[0];if(f)handleFile(f);}}
                    onClick={()=>fileInputRef.current?.click()}
                    style={{border:"2px dashed #D1D5DB",borderRadius:12,padding:"52px 20px",textAlign:"center",cursor:"pointer",background:"#FAFAF8",transition:"all 0.15s"}}>
                    <input ref={fileInputRef} type="file" accept=".pdf,.docx,.doc,.txt,.jpg,.jpeg,.png,.gif,.webp,.tiff" style={{display:"none"}} onChange={e=>handleFile(e.target.files?.[0])}/>
                    <div style={{fontSize:36,marginBottom:14}}>📄</div>
                    <div style={{fontSize:15,fontWeight:600,marginBottom:6}}>Drop your lease document here</div>
                    <div style={{fontSize:13,color:"#888",marginBottom:18,lineHeight:1.6}}>Claude extracts all fields — tenant, rent, dates, breaks, indexation, guarantees — mapped to the institutional rent roll schema.</div>
                    <div style={{display:"inline-flex",gap:8,marginBottom:16}}>{["PDF","DOCX","JPEG","PNG","TXT"].map(t=><span key={t} style={{fontSize:11,padding:"3px 12px",background:"#F3F2EE",borderRadius:20,fontWeight:500,color:"#666"}}>{t}</span>)}</div>
                    <div style={{fontSize:13,color:"#3B82F6",fontWeight:500}}>Click to browse files</div>
                  </div>
                </>}

                {(uploadStage==="reading"||uploadStage==="extracting")&&(
                  <div style={{background:"#fff",border:"1px solid #E8E6E0",borderRadius:12,padding:"52px 24px",textAlign:"center"}}>
                    <div style={{width:36,height:36,border:"3px solid #E8E6E0",borderTopColor:"#1A1A1A",borderRadius:"50%",margin:"0 auto 20px",animation:"spin 0.8s linear infinite"}}></div>
                    <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
                    <div style={{fontSize:15,fontWeight:600,marginBottom:8}}>{uploadStage==="reading"?"Reading document…":"Extracting lease data…"}</div>
                    <div style={{fontSize:13,color:"#888",marginBottom:28}}>{uploadStage==="reading"?`Loading ${uploadedFile?.name}`:"Claude is reading the lease and mapping all fields to the institutional schema. This takes around 15–20 seconds."}</div>
                    {uploadStage==="extracting"&&(
                      <div style={{display:"inline-flex",flexDirection:"column",gap:10,textAlign:"left"}}>
                        {["Identifying parties & property","Extracting lease term & dates","Finding contracted & passing rent","Locating rent review provisions","Checking break options & conditions","Reading indexation clauses","Identifying guarantees & deposits","Mapping to institutional schema"].map((s,i)=>(
                          <div key={s} style={{display:"flex",alignItems:"center",gap:10,fontSize:13,color:"#555"}}>
                            <div style={{width:14,height:14,borderRadius:"50%",border:"2px solid #E8E6E0",borderTopColor:"#1A1A1A",animation:`spin 0.9s linear ${i*0.1}s infinite`,flexShrink:0}}></div>{s}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {uploadStage==="review"&&editedData&&(
                  <div>
                    <div style={{background:"#F0FDF4",border:"1px solid #BBF7D0",borderRadius:8,padding:"12px 16px",marginBottom:20,fontSize:13,color:"#166534"}}>
                      <strong>✓ Extraction complete</strong> — Claude read <em>{uploadedFile?.name}</em>. Review and correct any fields below, then confirm to add to the institutional rent roll.
                      {editedData.extractionNotes&&<div style={{marginTop:5,fontSize:12,color:"#3B6D11"}}>Note: {editedData.extractionNotes}</div>}
                    </div>
                    {/* Grouped review fields */}
                    {[
                      {title:"Asset & Property",fields:[["assetName","Asset Name","text"],["country","Country","text"],["city","City","text"],["address","Full Address","text"],["useType","Use Type","select",["Logistics","Office","Retail","Industrial","Other"]]]},
                      {title:"Tenant",fields:[["tenantName","Tenant Legal Name","text"],["tenantTrade","Trade Name","text"],["tenantIndustry","Industry","text"],["tenantParent","Parent Company","text"],["currency","Currency","select",["GBP","EUR","USD"]]]},
                      {title:"Area",fields:[["areaSqm","Lettable Area (SQM)","number"],["warehouseSqm","Warehouse (SQM)","number"],["officeSqm","Office (SQM)","number"]]},
                      {title:"Rent",fields:[["contractedPA","Contracted PA (LCY)","number"],["passingPA","Passing PA (LCY)","number"],["ervPA","ERV PA (LCY)","number"]]},
                      {title:"Lease Term",fields:[["leaseStart","Lease Start","date"],["leaseExpiry","Lease Expiry","date"]]},
                      {title:"Break Options",fields:[["break1Date","Break 1 Date","date"],["break1Notice","Break 1 Notice (months)","number"],["break1Holder","Break 1 Holder","select",["Tenant","Landlord","Mutual"]]]},
                      {title:"Rent Reviews",fields:[["reviewType","Review Type","select",["OMV","CPI","RPI","Fixed Steps","Index","Combined","None"]],["reviewFreq","Frequency (months)","number"],["nextReview","Next Review Date","date"],["upwardsOnly","Upwards Only","bool"]]},
                      {title:"Indexation",fields:[["hasIndex","Has Indexation","bool"],["indexName","Index Name","select",["CPI","RPI","HICP","Other"]],["nextIndexDate","Next Indexation Date","date"],["indexFloor","Floor %","number"],["indexCap","Cap %","number"]]},
                      {title:"Guarantees",fields:[["hasGuarantee","Has Guarantee","bool"],["guarantorName","Guarantor Name","text"],["guaranteeAmt","Guarantee Amount PA","number"],["securityMonths","Security Deposit (months)","number"]]},
                    ].map(section=>(
                      <div key={section.title} style={{background:"#fff",border:"1px solid #E8E6E0",borderRadius:10,overflow:"hidden",marginBottom:12}}>
                        <div style={{padding:"8px 16px",background:"#F8F7F4",borderBottom:"1px solid #E8E6E0",fontSize:11,fontWeight:600,color:"#666",textTransform:"uppercase",letterSpacing:"0.06em"}}>{section.title}</div>
                        {section.fields.map(([key,label,type,opts])=>{
                          const conf = editedData.confidence?.[key];
                          const cc = conf?confColor(conf):null;
                          const val = editedData[key];
                          return (
                            <div key={key} style={{padding:"10px 16px",borderBottom:"1px solid #F0EEE8",display:"flex",alignItems:"center",gap:12}}>
                              <div style={{width:200,flexShrink:0}}>
                                <div style={{fontSize:12,fontWeight:500}}>{label}</div>
                                {cc&&<span style={{fontSize:10,padding:"1px 7px",borderRadius:10,background:cc.bg,color:cc.tc,border:`1px solid ${cc.bc}`,display:"inline-block",marginTop:3}}>{conf} confidence</span>}
                              </div>
                              <div style={{flex:1}}>
                                {type==="text"&&<input type="text" value={val||""} onChange={e=>setEditedData(p=>({...p,[key]:e.target.value}))} style={{width:"100%",padding:"6px 9px",border:"1px solid #E8E6E0",borderRadius:6,fontSize:12,fontFamily:"inherit",outline:"none",background:conf==="low"?"#FFFBEB":"#FAFAF8"}}/>}
                                {type==="number"&&<input type="number" value={val||""} onChange={e=>setEditedData(p=>({...p,[key]:e.target.value}))} style={{width:"100%",padding:"6px 9px",border:"1px solid #E8E6E0",borderRadius:6,fontSize:12,fontFamily:"inherit",outline:"none",background:conf==="low"?"#FFFBEB":"#FAFAF8"}}/>}
                                {type==="date"&&<input type="date" value={val||""} onChange={e=>setEditedData(p=>({...p,[key]:e.target.value}))} style={{width:"100%",padding:"6px 9px",border:"1px solid #E8E6E0",borderRadius:6,fontSize:12,fontFamily:"inherit",outline:"none",background:conf==="low"?"#FFFBEB":"#FAFAF8"}}/>}
                                {type==="select"&&<select value={val||""} onChange={e=>setEditedData(p=>({...p,[key]:e.target.value}))} style={{width:"100%",padding:"6px 9px",border:"1px solid #E8E6E0",borderRadius:6,fontSize:12,fontFamily:"inherit",outline:"none",background:"#FAFAF8"}}>{(opts||[]).map(o=><option key={o}>{o}</option>)}</select>}
                                {type==="bool"&&<div style={{display:"flex",gap:6}}>{["Yes","No"].map(opt=><button key={opt} onClick={()=>setEditedData(p=>({...p,[key]:opt==="Yes"?1:0}))} style={{padding:"5px 14px",border:`1px solid ${(val===1&&opt==="Yes")||(val===0&&opt==="No")?"#1A1A1A":"#E8E6E0"}`,borderRadius:6,background:(val===1&&opt==="Yes")||(val===0&&opt==="No")?"#1A1A1A":"#fff",color:(val===1&&opt==="Yes")||(val===0&&opt==="No")?"#fff":"#444",fontSize:12,cursor:"pointer"}}>{opt}</button>)}</div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                    <div style={{display:"flex",justifyContent:"space-between",marginTop:16}}>
                      <button onClick={()=>setUploadStage("drop")} style={{padding:"8px 16px",border:"1px solid #E8E6E0",borderRadius:8,background:"#fff",fontSize:13,cursor:"pointer",color:"#444"}}>← Try different file</button>
                      <button onClick={commitLease} style={{padding:"8px 20px",background:"#1A1A1A",color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:500,cursor:"pointer"}}>Confirm & add to rent roll ✓</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Lease detail slide-over */}
      {selectedLease&&(
        <div style={{position:"fixed",inset:0,zIndex:50}} onClick={()=>{setSelectedLease(null);setClausePanel(null);}}>
          <div style={{position:"absolute",right:0,top:0,bottom:0,width:clausePanel?860:520,background:"#fff",boxShadow:"-4px 0 30px rgba(0,0,0,0.12)",display:"flex",transition:"width 0.2s"}} onClick={e=>e.stopPropagation()}>

            {/* Main lease detail pane */}
            <div style={{width:520,flexShrink:0,overflowY:"auto",borderRight:clausePanel?"1px solid #E8E6E0":"none"}}>
              <div style={{padding:"18px 24px",borderBottom:"1px solid #E8E6E0",display:"flex",justifyContent:"space-between",alignItems:"flex-start",position:"sticky",top:0,background:"#fff",zIndex:1}}>
                <div>
                  <div style={{fontSize:16,fontWeight:600,letterSpacing:"-0.02em"}}>{selectedLease.tenantName}</div>
                  <div style={{fontSize:12,color:"#888",marginTop:2}}>{selectedLease.unitId} · {selectedLease.assetName}</div>
                </div>
                <button onClick={()=>{setSelectedLease(null);setClausePanel(null);}} style={{background:"none",border:"none",fontSize:18,cursor:"pointer",color:"#888",padding:"0 0 0 16px"}}>✕</button>
              </div>
              <div style={{padding:"0 24px 40px"}}>
                {COLUMN_GROUPS.map(g=>(
                  <div key={g.id} style={{marginTop:20}}>
                    <div style={{fontSize:10,fontWeight:600,color:"#888",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8,paddingBottom:6,borderBottom:`2px solid ${g.color}`}}>{g.label}</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 16px"}}>
                      {g.cols.filter(c=>!c.id.startsWith("_")).map(c=>{
                        const rendered = c.render(selectedLease);
                        const src = selectedLease.sources?.[c.id];
                        const isActive = clausePanel?.fieldId===c.id;
                        return (
                          <div key={c.id}
                            onClick={src ? ()=>setClausePanel({fieldId:c.id,fieldLabel:c.label,source:src}) : undefined}
                            style={{padding:"5px 7px",borderRadius:6,cursor:src?"pointer":"default",background:isActive?"#EFF6FF":"transparent",border:isActive?"1px solid #BFDBFE":"1px solid transparent",transition:"all 0.1s"}}
                            title={src?"Click to view lease clause source":undefined}>
                            <div style={{fontSize:10,color:"#999",marginBottom:1,display:"flex",alignItems:"center",gap:4}}>
                              {c.label}
                              {src&&<span style={{fontSize:9,background:"#DBEAFE",color:"#1E40AF",borderRadius:3,padding:"0 4px",fontWeight:600}}>SOURCE</span>}
                            </div>
                            <div style={{fontSize:12,fontWeight:500}}>{rendered||"—"}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* Approval log */}
                {selectedLease.approvalLog?.length>0&&(
                  <div style={{marginTop:24}}>
                    <div style={{fontSize:10,fontWeight:600,color:"#888",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10,paddingBottom:6,borderBottom:"2px solid #F3F2EE"}}>Approval log</div>
                    {selectedLease.approvalLog.map(log=>(
                      <div key={log.id} style={{display:"flex",gap:10,marginBottom:12,paddingBottom:12,borderBottom:"1px solid #F0EEE8"}}>
                        <div style={{width:32,height:32,borderRadius:"50%",background:"#1A1A1A",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:600,flexShrink:0}}>
                          {TEAM.find(t=>t.name===log.approver)?.initials||log.approver.slice(0,2).toUpperCase()}
                        </div>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                            <div style={{fontSize:12,fontWeight:500}}>{log.approver} <span style={{fontWeight:400,color:"#888"}}>· {log.approverRole}</span></div>
                            <div style={{fontSize:11,color:"#aaa"}}>{log.date} {log.timestamp}</div>
                          </div>
                          <div style={{fontSize:12,color:"#555",marginTop:2}}>{log.eventTitle}</div>
                          <div style={{display:"flex",gap:6,marginTop:4,flexWrap:"wrap"}}>
                            <span style={{fontSize:10,padding:"1px 7px",borderRadius:10,background:log.outcome==="not_served"?"#F0FDF4":log.outcome==="served"?"#FEF2F2":"#EFF6FF",color:log.outcome==="not_served"?"#166534":log.outcome==="served"?"#991B1B":"#1E40AF",fontWeight:600}}>
                              {log.outcome==="not_served"?"Break not served":log.outcome==="served"?"Break served":log.outcome==="rent_updated"?"Rent updated":log.outcome}
                            </span>
                            {log.newRent&&<span style={{fontSize:10,padding:"1px 7px",borderRadius:10,background:"#F5F3FF",color:"#5B21B6",fontWeight:600}}>New rent: {fmt.currency(log.newRent,"")}</span>}
                            {log.docName&&<span style={{fontSize:10,padding:"1px 7px",borderRadius:10,background:"#FFFBEB",color:"#92400E",fontWeight:600}}>📎 {log.docName}</span>}
                          </div>
                          {log.note&&<div style={{fontSize:11,color:"#888",marginTop:3,fontStyle:"italic"}}>"{log.note}"</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {actions.filter(a=>a.leaseId===selectedLease.id).length>0&&(
                  <div style={{marginTop:20,padding:14,background:"#FEF3C7",border:"1px solid #FDE68A",borderRadius:8}}>
                    <div style={{fontSize:11,fontWeight:600,color:"#92400E",marginBottom:6}}>ACTION REQUIRED</div>
                    {actions.filter(a=>a.leaseId===selectedLease.id).map(a=>(
                      <div key={a.id} style={{fontSize:12,color:"#92400E",marginBottom:4}}>{a.title}</div>
                    ))}
                    <button onClick={()=>{setSelectedLease(null);setClausePanel(null);setView("actions");}} style={{marginTop:8,padding:"6px 12px",background:"#1A1A1A",color:"#fff",border:"none",borderRadius:6,fontSize:12,cursor:"pointer"}}>Go to action queue →</button>
                  </div>
                )}
              </div>
            </div>

            {/* Clause source panel */}
            {clausePanel&&(
              <div style={{flex:1,overflowY:"auto",padding:"0 0 40px",minWidth:0}}>
                <div style={{padding:"18px 24px",borderBottom:"1px solid #E8E6E0",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:"#fff",zIndex:1}}>
                  <div>
                    <div style={{fontSize:11,color:"#888",marginBottom:2}}>Lease source — {clausePanel.fieldLabel}</div>
                    <div style={{fontSize:13,fontWeight:600}}>{clausePanel.source.section}</div>
                  </div>
                  <button onClick={()=>setClausePanel(null)} style={{background:"none",border:"none",fontSize:16,cursor:"pointer",color:"#888"}}>✕</button>
                </div>
                <div style={{padding:"20px 24px"}}>
                  <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
                    <span style={{fontSize:11,padding:"3px 10px",background:"#EFF6FF",color:"#1E40AF",borderRadius:6,fontWeight:500}}>📄 {clausePanel.source.pageRef}</span>
                    <span style={{fontSize:11,padding:"3px 10px",background:"#F5F3FF",color:"#5B21B6",borderRadius:6,fontWeight:500}}>{clausePanel.source.section}</span>
                  </div>
                  <div style={{background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:8,padding:"16px 18px",marginBottom:16}}>
                    <div style={{fontSize:10,fontWeight:600,color:"#92400E",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.06em"}}>Extracted clause text</div>
                    <div style={{fontSize:13,lineHeight:1.8,color:"#1A1A1A",fontFamily:"Georgia, serif"}}>{clausePanel.source.clauseText}</div>
                  </div>
                  <div style={{fontSize:11,color:"#aaa",lineHeight:1.6}}>
                    This clause text was extracted by AI during lease upload. Always verify against the original executed document. Click any other highlighted field in the lease detail to view its source clause.
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* Action resolve modal */}
      {actionModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100}}>
          <div style={{background:"#fff",borderRadius:12,padding:28,width:540,maxWidth:"95vw",maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{fontSize:10,fontWeight:600,color:"#888",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>{actionModal.type} action</div>
            <h3 style={{fontSize:15,fontWeight:600,margin:"0 0 4px"}}>{actionModal.title}</h3>
            <p style={{fontSize:12,color:"#666",margin:"0 0 18px",lineHeight:1.6}}>{actionModal.desc}</p>

            {/* Approver selector */}
            <div style={{marginBottom:16}}>
              <label style={{fontSize:11,fontWeight:600,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.04em",color:"#555"}}>Approved by</label>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {TEAM.map(t=>(
                  <button key={t.id} onClick={()=>setModalInputs(p=>({...p,approverId:t.id}))}
                    style={{display:"flex",alignItems:"center",gap:7,padding:"7px 12px",border:`1px solid ${modalInputs.approverId===t.id?"#1A1A1A":"#E8E6E0"}`,borderRadius:8,background:modalInputs.approverId===t.id?"#1A1A1A":"#fff",color:modalInputs.approverId===t.id?"#fff":"#444",fontSize:12,cursor:"pointer"}}>
                    <span style={{width:22,height:22,borderRadius:"50%",background:modalInputs.approverId===t.id?"rgba(255,255,255,0.25)":"#F3F2EE",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700}}>{t.initials}</span>
                    <span>{t.name}</span>
                  </button>
                ))}
              </div>
              {modalInputs.approverId&&<div style={{fontSize:11,color:"#888",marginTop:5}}>Role: {TEAM.find(t=>t.id===modalInputs.approverId)?.role}</div>}
            </div>

            {actionModal.type==="break"&&(
              <div style={{marginBottom:16}}>
                <label style={{fontSize:11,fontWeight:600,display:"block",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.04em",color:"#555"}}>Break outcome</label>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  <button onClick={()=>setModalInputs(p=>({...p,outcome:"not_served"}))}
                    style={{padding:"11px 16px",background:modalInputs.outcome==="not_served"?"#F0FDF4":"#fff",border:`1px solid ${modalInputs.outcome==="not_served"?"#166534":"#E8E6E0"}`,borderRadius:8,fontSize:13,fontWeight:500,color:"#166534",cursor:"pointer",textAlign:"left"}}>
                    ✓  Break was not served — lease continues as normal
                  </button>
                  <button onClick={()=>setModalInputs(p=>({...p,outcome:"served"}))}
                    style={{padding:"11px 16px",background:modalInputs.outcome==="served"?"#FEF2F2":"#fff",border:`1px solid ${modalInputs.outcome==="served"?"#991B1B":"#E8E6E0"}`,borderRadius:8,fontSize:13,fontWeight:500,color:"#991B1B",cursor:"pointer",textAlign:"left"}}>
                    ✗  Break notice was served — lease terminates on break date
                  </button>
                </div>
                {modalInputs.outcome==="served"&&(
                  <div style={{marginTop:12,padding:12,background:"#FEF2F2",borderRadius:8,border:"1px solid #FECACA"}}>
                    <label style={{fontSize:11,fontWeight:600,display:"block",marginBottom:6,color:"#991B1B"}}>📎 Upload break notice (required)</label>
                    <DocUpload value={modalInputs.docName} onChange={n=>setModalInputs(p=>({...p,docName:n}))} />
                  </div>
                )}
              </div>
            )}

            {(actionModal.type==="review"||actionModal.type==="indexation")&&(
              <div style={{marginBottom:16}}>
                <label style={{fontSize:11,fontWeight:600,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.04em",color:"#555"}}>New passing rent (LCY p.a.)</label>
                <input type="number" placeholder="Enter agreed annual rent figure" value={modalInputs.newRent||""} onChange={e=>setModalInputs(p=>({...p,newRent:e.target.value}))}
                  style={{width:"100%",padding:"9px 12px",border:"1px solid #E8E6E0",borderRadius:7,fontSize:13,fontFamily:"inherit",outline:"none"}}/>
                <div style={{marginTop:12}}>
                  <label style={{fontSize:11,fontWeight:600,display:"block",marginBottom:6,color:"#555"}}>📎 Upload supporting document (required) <span style={{fontWeight:400,color:"#999"}}>— rent review letter / indexation notice</span></label>
                  <DocUpload value={modalInputs.docName} onChange={n=>setModalInputs(p=>({...p,docName:n}))} />
                </div>
              </div>
            )}

            {/* Notes */}
            <div style={{marginBottom:18}}>
              <label style={{fontSize:11,fontWeight:600,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.04em",color:"#555"}}>Notes <span style={{fontWeight:400,color:"#aaa"}}>(optional)</span></label>
              <textarea value={modalInputs.note||""} onChange={e=>setModalInputs(p=>({...p,note:e.target.value}))} placeholder="Add any context or notes for the audit log…" rows={2}
                style={{width:"100%",padding:"8px 12px",border:"1px solid #E8E6E0",borderRadius:7,fontSize:13,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
            </div>

            {/* Submit */}
            {(()=>{
              const hasApprover = !!modalInputs.approverId;
              const breakReady = actionModal.type==="break" && !!modalInputs.outcome && (modalInputs.outcome==="not_served" || !!modalInputs.docName);
              const rentReady = (actionModal.type==="review"||actionModal.type==="indexation") && !!modalInputs.newRent && !!modalInputs.docName;
              const canSubmit = hasApprover && (breakReady || rentReady);
              return (
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <button onClick={()=>{setActionModal(null);setModalInputs({});}} style={{fontSize:13,color:"#888",background:"none",border:"none",cursor:"pointer"}}>Cancel</button>
                  <button disabled={!canSubmit} onClick={()=>resolveAction(actionModal, modalInputs)}
                    style={{padding:"9px 22px",background:canSubmit?"#1A1A1A":"#E8E6E0",color:canSubmit?"#fff":"#aaa",border:"none",borderRadius:8,fontSize:13,fontWeight:500,cursor:canSubmit?"pointer":"default"}}>
                    Approve & update rent roll ✓
                  </button>
                </div>
              );
            })()}
            {!modalInputs.approverId&&<div style={{fontSize:11,color:"#aaa",marginTop:8,textAlign:"right"}}>Select an approver to continue</div>}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast&&(
        <div style={{position:"fixed",bottom:24,right:24,background:"#1A1A1A",color:"#fff",padding:"10px 16px",borderRadius:8,fontSize:13,fontWeight:500,zIndex:200}}>✓ {toast.msg}</div>
      )}
    </div>
  );
}

function DocUpload({ value, onChange }) {
  const ref = React.useRef();
  if (value) return (
    <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:"#F0FDF4",border:"1px solid #BBF7D0",borderRadius:7}}>
      <span style={{fontSize:13}}>📎</span>
      <span style={{fontSize:12,fontWeight:500,flex:1}}>{value}</span>
      <button onClick={()=>onChange(null)} style={{background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:13}}>✕</button>
    </div>
  );
  return (
    <div>
      <input ref={ref} type="file" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0]; if(f) onChange(f.name);}} />
      <button onClick={()=>ref.current?.click()}
        style={{width:"100%",padding:"9px 14px",border:"1px dashed #D1D5DB",borderRadius:7,background:"#FAFAF8",fontSize:12,color:"#666",cursor:"pointer",textAlign:"center"}}>
        Click to upload supporting document (PDF, DOCX, image)
      </button>
    </div>
  );
}
