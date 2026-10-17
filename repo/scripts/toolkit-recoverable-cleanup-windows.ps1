param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$Target,
  [string]$Quarantine, [Parameter(Mandatory)][string]$Manifest,
  [Parameter(Mandatory)][string]$ManifestSha256, [string]$ContentSha256,
  [string]$ExpectedInode, [string]$Mode='FILE_QUARANTINE', [string]$InventoryJsonBase64,
  [string]$ExpectedRootVolume, [string]$ExpectedRootLinks, [string]$ApprovalReferenceDigest,
  [string]$AcceptedActionDigest, [string]$CandidateDigest, [string]$ModuleDigest, [string]$NativeHelperDigest)
$ErrorActionPreference = 'Stop'
if ($Mode -eq 'DIRECTORY_DISPOSAL') {
  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;
public sealed class ToolkitDirectoryOutcome { public string state; public string code; public string[] completed_entries; public bool target_absent; }
public static class ToolkitDirectoryDisposal {
  [StructLayout(LayoutKind.Sequential)] struct Info { public uint attributes,creationLow,creationHigh,accessLow,accessHigh,writeLow,writeHigh,volume,sizeHigh,sizeLow,links,indexHigh,indexLow; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string n,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info info);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetFileInformationByHandle(SafeFileHandle h,int cls,IntPtr info,uint size);
  const uint READ_ATTRIBUTES=0x80, GENERIC_READ=0x80000000, DELETE=0x00010000, OPEN_EXISTING=3, OPEN_FLAGS=0x02200000, SHARE_READ=1, DIRECTORY=0x10, REPARSE=0x400;
  static SafeFileHandle Open(string path,uint access,uint share,bool directory) {
    var h=CreateFileW(path,access,share,IntPtr.Zero,OPEN_EXISTING,OPEN_FLAGS|(directory?0x02000000u:0u),IntPtr.Zero);
    if(h.IsInvalid)throw new IOException("CLEANUP_EXCLUSIVITY_UNAVAILABLE:"+Marshal.GetLastWin32Error());
    Info i;if(!GetFileInformationByHandle(h,out i)||(i.attributes&REPARSE)!=0){h.Dispose();throw new IOException("CLEANUP_ALIAS_OR_IDENTITY_UNKNOWN");}
    if(directory!=((i.attributes&DIRECTORY)!=0)){h.Dispose();throw new IOException("CLEANUP_ENTRY_TYPE_DRIFT");}return h;
  }
  static string Id(SafeFileHandle h){Info i;if(!GetFileInformationByHandle(h,out i))throw new IOException("CLEANUP_IDENTITY_READ_FAILED");return i.volume.ToString()+":"+(((ulong)i.indexHigh<<32)|i.indexLow).ToString()+":"+i.links.ToString();}
  static string Hash(SafeFileHandle h){using(var b=new SafeFileHandle(h.DangerousGetHandle(),false))using(var s=new FileStream(b,FileAccess.Read))using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(s)).Replace("-","").ToLowerInvariant();}
  static void MarkDelete(SafeFileHandle h){IntPtr p=Marshal.AllocHGlobal(1);try{Marshal.WriteByte(p,0,1);if(!SetFileInformationByHandle(h,4,p,1))throw new IOException("CLEANUP_HANDLE_DISPOSITION_FAILED:"+Marshal.GetLastWin32Error());}finally{Marshal.FreeHGlobal(p);}}
  static List<string> Enumerate(string root){var found=new List<string>();Action<string,string,int> walk=null;walk=(dir,rel,depth)=>{if(depth>8)throw new IOException("CLEANUP_DIRECTORY_DEPTH_LIMIT");foreach(var item in Directory.GetFileSystemEntries(dir)){var name=Path.GetFileName(item);var child=rel.Length==0?name:rel+"/"+name;var attr=File.GetAttributes(item);if((attr&REPARSE)!=0)throw new IOException("CLEANUP_ALIAS");found.Add(((attr&DIRECTORY)!=0?"D:":"F:")+child);if((attr&DIRECTORY)!=0)walk(item,child,depth+1);}};walk(root,"",1);found.Sort(StringComparer.Ordinal);return found;}
  public static ToolkitDirectoryOutcome Dispose(string root,string target,string manifest,string manifestHash,string rootIdentity,string[] paths,string[] types,string[] hashes,long[] sizes,string[] identities){
    var pinned=new List<SafeFileHandle>();var opened=new List<SafeFileHandle>();var completed=new List<string>();bool started=false;
    try{
      root=Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;target=Path.GetFullPath(target);manifest=Path.GetFullPath(manifest);
      if(!target.StartsWith(root,StringComparison.OrdinalIgnoreCase)||target==root.TrimEnd(Path.DirectorySeparatorChar)||!manifest.StartsWith(root,StringComparison.OrdinalIgnoreCase))throw new IOException("CLEANUP_OUTSIDE_TASK_ROOT");
      var mh=Open(manifest,GENERIC_READ,SHARE_READ,false);opened.Add(mh);if(Hash(mh)!=manifestHash)throw new IOException("CLEANUP_MANIFEST_DRIFT");
      var rh=Open(target,READ_ATTRIBUTES|DELETE,0,true);opened.Add(rh);if(Id(rh)!=rootIdentity)throw new IOException("CLEANUP_ROOT_IDENTITY_DRIFT");
      var parent=Path.GetDirectoryName(target);while(parent!=null&&parent.StartsWith(root,StringComparison.OrdinalIgnoreCase)){pinned.Add(Open(parent,READ_ATTRIBUTES,SHARE_READ,true));parent=Path.GetDirectoryName(parent);}
      if(paths.Length!=types.Length||paths.Length!=hashes.Length||paths.Length!=sizes.Length||paths.Length!=identities.Length||paths.Length>64)throw new IOException("CLEANUP_INVENTORY_INVALID");
      var expected=new List<string>();
      for(int i=0;i<paths.Length;i++){var rel=paths[i].Replace('\\','/');if(rel.Length==0||rel.StartsWith("/")||rel.Split('/').Length>8)throw new IOException("CLEANUP_INVENTORY_PATH_INVALID");foreach(var part in rel.Split('/'))if(part=="."||part==".."||part.Equals(".git",StringComparison.OrdinalIgnoreCase))throw new IOException("CLEANUP_INVENTORY_PATH_INVALID");bool dir=types[i]=="DIRECTORY";if(!dir&&types[i]!="FILE")throw new IOException("CLEANUP_INVENTORY_TYPE_INVALID");var full=Path.GetFullPath(Path.Combine(target,rel.Replace('/',Path.DirectorySeparatorChar)));if(!full.StartsWith(target+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new IOException("CLEANUP_INVENTORY_ESCAPE");var h=Open(full,READ_ATTRIBUTES|DELETE|(dir?0:GENERIC_READ),0,dir);opened.Add(h);if(Id(h)!=identities[i])throw new IOException("CLEANUP_IDENTITY_DRIFT");Info info;if(!GetFileInformationByHandle(h,out info))throw new IOException("CLEANUP_IDENTITY_READ_FAILED");if(!dir){ulong len=((ulong)info.sizeHigh<<32)|info.sizeLow;if(info.links!=1||len!=(ulong)sizes[i]||Hash(h)!=hashes[i])throw new IOException("CLEANUP_FILE_CONTENT_OR_LINK_DRIFT");}expected.Add((dir?"D:":"F:")+rel);}
      expected.Sort(StringComparer.Ordinal);if(String.Join("\n",Enumerate(target))!=String.Join("\n",expected))throw new IOException("CLEANUP_UNLISTED_CHILD_OR_INVENTORY_DRIFT");
      var files=new List<int>();var dirs=new List<int>();for(int i=0;i<paths.Length;i++)if(types[i]=="FILE")files.Add(i);else dirs.Add(i);files.Sort((a,b)=>StringComparer.Ordinal.Compare(paths[a],paths[b]));dirs.Sort((a,b)=>{int da=paths[a].Split('/').Length,db=paths[b].Split('/').Length;return db!=da?db-da:StringComparer.Ordinal.Compare(paths[b],paths[a]);});
      foreach(int i in files){started=true;MarkDelete(opened[2+i]);opened[2+i].Dispose();completed.Add(paths[i]);}
      foreach(int i in dirs){started=true;MarkDelete(opened[2+i]);opened[2+i].Dispose();completed.Add(paths[i]);}
      MarkDelete(rh);rh.Dispose();if(Directory.Exists(target)||File.Exists(target))throw new IOException("CLEANUP_TARGET_ABSENCE_UNVERIFIED");
      return new ToolkitDirectoryOutcome{state="IRREVERSIBLE_LOCAL_DISPOSAL",code="",completed_entries=completed.ToArray(),target_absent=true};
    }catch(Exception ex){return new ToolkitDirectoryOutcome{state=started?"PARTIAL":"HOLD",code=ex.Message,completed_entries=completed.ToArray(),target_absent=!(Directory.Exists(target)||File.Exists(target))};}
    finally{for(int i=opened.Count-1;i>=0;i--)try{opened[i].Dispose();}catch{}for(int i=pinned.Count-1;i>=0;i--)try{pinned[i].Dispose();}catch{}}
  }
}
'@
  try {
    foreach ($identityDigest in @($ApprovalReferenceDigest,$AcceptedActionDigest,$CandidateDigest,$ModuleDigest,$NativeHelperDigest)) {
      if ($identityDigest -notmatch '^[a-f0-9]{64}$') { throw 'CLEANUP_NATIVE_ACTION_IDENTITY_INVALID' }
    }
    $items = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($InventoryJsonBase64)) | ConvertFrom-Json
    $paths = [string[]]@($items | ForEach-Object { $_.relative_path })
    $types = [string[]]@($items | ForEach-Object { $_.type })
    $hashes = [string[]]@($items | ForEach-Object { if ($_.sha256) { $_.sha256 } else { '' } })
    $sizes = [long[]]@($items | ForEach-Object { if ($_.bytes -ne $null) { [long]$_.bytes } else { 0L } })
    $identities = [string[]]@($items | ForEach-Object { "$($_.identity.volume_serial):$($_.identity.file_id):$($_.identity.links)" })
    $rootIdentity = "$ExpectedRootVolume`:$ExpectedInode`:$ExpectedRootLinks"
    $nativeOutcome = [ToolkitDirectoryDisposal]::Dispose($Root,$Target,$Manifest,$ManifestSha256,$rootIdentity,$paths,$types,$hashes,$sizes,$identities)
    @{ state=$nativeOutcome.state; code=$nativeOutcome.code; completed_entries=$nativeOutcome.completed_entries; target_absent=$nativeOutcome.target_absent;
      approval_reference_digest=$ApprovalReferenceDigest; accepted_action_digest=$AcceptedActionDigest; candidate_digest=$CandidateDigest;
      module_digest=$ModuleDigest; native_helper_digest=$NativeHelperDigest } | ConvertTo-Json -Compress
    exit 0
  } catch { @{ state='HOLD'; code=$_.Exception.GetBaseException().Message; completed_entries=@(); target_absent=$false;
    approval_reference_digest=$ApprovalReferenceDigest; accepted_action_digest=$AcceptedActionDigest; candidate_digest=$CandidateDigest;
    module_digest=$ModuleDigest; native_helper_digest=$NativeHelperDigest } | ConvertTo-Json -Compress; exit 2 }
}

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;
public static class ToolkitRecoverableCleanup {
  [StructLayout(LayoutKind.Sequential)] struct Info {
    public uint attributes,creationLow,creationHigh,accessLow,accessHigh,writeLow,writeHigh,volume,sizeHigh,sizeLow,links,indexHigh,indexLow;
  }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string n,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info info);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetFileInformationByHandle(SafeFileHandle h,int cls,IntPtr info,uint size);
  static SafeFileHandle Open(string n,uint access,uint share) {
    var h=CreateFileW(n,access,share,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
    if(h.IsInvalid) throw new IOException("CLEANUP_EXCLUSIVITY_UNAVAILABLE:"+Marshal.GetLastWin32Error());
    Info i;if(!GetFileInformationByHandle(h,out i)||(i.attributes&0x400)!=0){h.Dispose();throw new IOException("CLEANUP_ALIAS");}
    return h;
  }
  static string Digest(SafeFileHandle h) {
    using(var borrowed=new SafeFileHandle(h.DangerousGetHandle(),false))
    using(var stream=new FileStream(borrowed,FileAccess.Read))
    using(var hash=SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-","").ToLowerInvariant();
  }
  public static string Move(string root,string target,string destination,string manifest,string manifestHash,string contentHash,string expectedInode) {
    root=Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
    var pins=new List<SafeFileHandle>();
    try {
      foreach(var item in new[]{target,destination,manifest}) {
        var full=Path.GetFullPath(item);if(!full.StartsWith(root,StringComparison.OrdinalIgnoreCase))throw new IOException("CLEANUP_OUTSIDE_TASK_ROOT");
        // Pin every ancestor against rename/removal. Reparse points are rejected.
        var current=Path.GetDirectoryName(full);
        while(current!=null){pins.Add(Open(current,0,3));current=Path.GetDirectoryName(current);}
      }
      if(File.Exists(destination)||Directory.Exists(destination))throw new IOException("CLEANUP_DESTINATION_EXISTS");
      // The manifest is held without write/delete sharing through the operation.
      // All participating eligibility/consumer writers must use this same manifest.
      using(var m=Open(manifest,0x80000000,1)) {
        if(Digest(m)!=manifestHash)throw new IOException("CLEANUP_ELIGIBILITY_DRIFT");
        using(var h=Open(target,0x80010000,0)) {
          Info i;if(!GetFileInformationByHandle(h,out i)||i.links!=1||(i.attributes&0x10)!=0)throw new IOException("CLEANUP_SINGLE_REGULAR_FILE_REQUIRED");
          if((((ulong)i.indexHigh<<32)|i.indexLow).ToString()!=expectedInode)throw new IOException("CLEANUP_TARGET_IDENTITY_DRIFT");
          if(Digest(h)!=contentHash)throw new IOException("CLEANUP_TARGET_DRIFT");
          byte[] name=System.Text.Encoding.Unicode.GetBytes(Path.GetFullPath(destination));
          int offset=IntPtr.Size==8?20:12;IntPtr buffer=Marshal.AllocHGlobal(offset+name.Length+2);
          try {
            for(int n=0;n<offset;n++)Marshal.WriteByte(buffer,n,0);
            Marshal.WriteInt32(buffer,IntPtr.Size==8?16:8,name.Length);Marshal.Copy(name,0,IntPtr.Add(buffer,offset),name.Length);
            Marshal.WriteInt16(buffer,offset+name.Length,0);
            // Rename by the already verified exclusive handle; never delete by path.
            if(!SetFileInformationByHandle(h,3,buffer,(uint)(offset+name.Length+2)))throw new IOException("CLEANUP_NATIVE_RENAME_FAILED:"+Marshal.GetLastWin32Error());
          } finally {Marshal.FreeHGlobal(buffer);}
          return "RECOVERABLY_QUARANTINED";
        }
      }
    } finally {foreach(var h in pins)h.Dispose();}
  }
}
'@
try {
  $state = [ToolkitRecoverableCleanup]::Move($Root,$Target,$Quarantine,$Manifest,$ManifestSha256,$ContentSha256,$ExpectedInode)
  @{ state=$state; irreversible_deletion=$false; source_present=[IO.File]::Exists($Target); quarantine_present=[IO.File]::Exists($Quarantine) } | ConvertTo-Json -Compress
} catch {
  @{ state='HOLD'; code=$_.Exception.GetBaseException().Message; irreversible_deletion=$false } | ConvertTo-Json -Compress
  exit 2
}
