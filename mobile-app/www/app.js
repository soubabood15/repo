import { Network } from "@capacitor/network";
import { StatusBar, Style } from "@capacitor/status-bar";

const destinations={
  ebook:"https://YOUR-COMPANY-DOMAIN/ebook.html",
  "auto-answer":"https://YOUR-COMPANY-DOMAIN/ebook.html#auto-answer",
  profile:"https://YOUR-COMPANY-DOMAIN/ebook.html#profile",
  support:"mailto:support@newtel.example"
};

const toast=document.getElementById("toast");
function showToast(message){
  toast.textContent=message;
  toast.classList.add("show");
  window.setTimeout(()=>toast.classList.remove("show"),2200);
}

async function updateNetworkStatus(status){
  const target=document.getElementById("networkStatus");
  if(target)target.textContent=status.connected?"Connected to NEWTEL services":"You are offline";
}

document.querySelectorAll("[data-destination]").forEach(button=>button.addEventListener("click",()=>{
  const key=button.dataset.destination;
  const url=destinations[key];
  if(!url||url.includes("YOUR-COMPANY-DOMAIN"))return showToast("Company server address will be connected next.");
  window.location.href=url;
}));

try{
  await StatusBar.setStyle({style:Style.Dark});
  await StatusBar.setBackgroundColor({color:"#087ec2"});
  await updateNetworkStatus(await Network.getStatus());
  await Network.addListener("networkStatusChange",updateNetworkStatus);
}catch(_error){
  updateNetworkStatus({connected:navigator.onLine});
}
